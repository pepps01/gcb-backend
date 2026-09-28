import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';
import { env } from '../../config/env';
import { syncScopedConversations } from '../chat/membership';
import { assertValidLocation, withLocationNames } from '../locations/resolve';

const router = Router();

// Location defaults to what the member saved in step 1 (PATCH /api/members/me)
const submitSchema = z.object({
    nin: z.string().regex(/^\d{11}$/, 'NIN must be 11 digits'),
    vin: z.string().trim().min(10).max(30),
    lga_id: z.number().int().optional(),
    ward_id: z.number().int().optional(),
    polling_unit_id: z.number().int().optional(),
    nin_slip_upload_id: z.string().uuid().optional(),
    pvc_upload_id: z.string().uuid().optional(),
});

/** The upload must be the caller's own and of the expected kind. */
async function ownUpload(tenant_id: string, member_id: string, id: string | undefined, kind: string) {
    if (!id) return null;
    const u = await prisma.upload.findFirst({ where: { id, tenant_id, member_id, kind }, select: { id: true } });
    if (!u) throw { status: 400, message: `Unknown ${kind === 'kyc_pvc' ? 'voter card' : 'NIN slip'} upload` };
    return u.id;
}

// Keyed hash: NIN/VIN have tiny search spaces, so an unkeyed hash could be brute-forced offline.
const hmac = (s: string) => crypto.createHmac('sha256', env.KYC_PEPPER).update(s).digest('hex');

router.post(
    '/submit',
    requireAuth,
    asyncHandler(async (req, res) => {
        const body = submitSchema.parse(req.body);
        const tenant_id = req.tenant!.id;
        const member_id = req.membership!.id;

        const saved = await prisma.tenantMember.findUniqueOrThrow({
            where: { id: member_id },
            select: { lga_id: true, ward_id: true, polling_unit_id: true },
        });
        const lga_id = body.lga_id ?? saved.lga_id;
        const ward_id = body.ward_id ?? saved.ward_id;
        const polling_unit_id = body.polling_unit_id ?? saved.polling_unit_id;
        if (!lga_id || !ward_id || !polling_unit_id) throw { status: 400, message: 'Choose your LGA, ward and polling unit first' };
        await assertValidLocation(tenant_id, lga_id, ward_id, polling_unit_id);

        const nin_hash = hmac(body.nin);
        const fields = {
            vin_hash: hmac(body.vin),
            nin_slip_upload_id: await ownUpload(tenant_id, member_id, body.nin_slip_upload_id, 'kyc_nin_slip'),
            pvc_upload_id: await ownUpload(tenant_id, member_id, body.pvc_upload_id, 'kyc_pvc'),
            lga_id,
            ward_id,
            polling_unit_id,
        };

        await prisma.$transaction(async (tx) => {
            const live = await tx.kycSubmission.findFirst({
                where: { tenant_id, member_id, status: { in: ['pending', 'verified'] } },
                select: { id: true },
            });
            if (live) throw { status: 409, message: 'You already have a pending or verified submission' };

            const sameNin = await tx.kycSubmission.findUnique({
                where: { tenant_id_nin_hash: { tenant_id, nin_hash } },
                select: { id: true, member_id: true, status: true },
            });
            if (!sameNin) {
                await tx.kycSubmission.create({ data: { tenant_id, member_id, nin_hash, status: 'pending', ...fields } });
            } else if (sameNin.member_id === member_id && sameNin.status === 'rejected') {
                // Same member fixing a rejected submission: reset it to pending
                await tx.kycSubmission.update({
                    where: { id: sameNin.id },
                    data: { ...fields, status: 'pending', rejection_reason: null, reviewed_by: null, reviewed_at: null },
                });
            } else {
                throw { status: 409, message: 'This NIN has already been submitted' };
            }

            await tx.tenantMember.update({
                where: { id: member_id },
                data: { lga_id, ward_id, polling_unit_id },
            });
        });

        res.status(201).json({ status: 'pending' });
    })
);

router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
        const submission = await prisma.kycSubmission.findFirst({
            where: { tenant_id: req.tenant!.id, member_id: req.membership!.id },
            orderBy: { created_at: 'desc' },
            select: { id: true, status: true, rejection_reason: true, created_at: true, reviewed_at: true },
        });
        res.json({ submission });
    })
);

// Admin verification queue. NIN/VIN are never returned: only their hashes are stored.
router.get(
    '/submissions',
    requireAuth,
    requireRole('tenant_admin', 'lga_coordinator'),
    asyncHandler(async (req, res) => {
        const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
        const submissions = await prisma.kycSubmission.findMany({
            where: { tenant_id: req.tenant!.id, status },
            orderBy: { created_at: 'asc' },
            take: 200,
            select: {
                id: true, status: true, lga_id: true, ward_id: true, polling_unit_id: true,
                nin_slip_upload_id: true, pvc_upload_id: true, rejection_reason: true, created_at: true, reviewed_at: true,
                member: { select: { id: true, user: { select: { full_name: true, phone: true } } } },
            },
        });
        res.json({ submissions: await withLocationNames(req.tenant!.id, submissions) });
    })
);

const reviewSchema = z.object({
    submission_id: z.string().uuid(),
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().optional(),
});

router.post(
    '/review',
    requireAuth,
    requireRole('tenant_admin', 'lga_coordinator'),
    asyncHandler(async (req, res) => {
        const body = reviewSchema.parse(req.body);
        const tenant_id = req.tenant!.id;

        const sub = await prisma.$transaction(async (tx) => {
            const sub = await tx.kycSubmission.findFirst({
                where: { id: body.submission_id, tenant_id, status: 'pending' },
                select: { id: true, member_id: true },
            });
            if (!sub) throw { status: 404, message: 'Pending submission not found' };

            await tx.kycSubmission.update({
                where: { id: sub.id },
                data: {
                    status: body.decision,
                    rejection_reason: body.reason || null,
                    reviewed_by: req.user!.id,
                    reviewed_at: new Date(),
                },
            });

            // Never overwrite a banned member's status
            await tx.tenantMember.updateMany({
                where: { id: sub.member_id, tenant_id, status: { not: 'banned' } },
                data: { status: body.decision, verified_at: body.decision === 'verified' ? new Date() : null },
            });
            return sub;
        });
        // Verified members join their ward/LGA chats; rejected ones leave them
        await syncScopedConversations(tenant_id, req.tenant!.features, sub.member_id);

        res.json({ ok: true });
    })
);

export default router;
