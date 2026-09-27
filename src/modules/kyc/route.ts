import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';
import { env } from '../../config/env';

const router = Router();

const submitSchema = z.object({
    nin: z.string().length(11),
    vin: z.string().min(10),
    lga_id: z.number().int(),
    ward_id: z.number().int(),
    polling_unit_id: z.number().int(),
    nin_slip_url: z.string().url().optional(),
    pvc_url: z.string().url().optional(),
});

// Keyed hash: NIN/VIN have tiny search spaces, so an unkeyed hash could be brute-forced offline.
const hmac = (s: string) => crypto.createHmac('sha256', env.KYC_PEPPER).update(s).digest('hex');

router.post(
    '/submit',
    requireAuth,
    asyncHandler(async (req, res) => {
        const body = submitSchema.parse(req.body);
        const tenant_id = req.tenant!.id;
        const member_id = req.membership!.id;

        const nin_hash = hmac(body.nin);
        const fields = {
            vin_hash: hmac(body.vin),
            nin_slip_url: body.nin_slip_url || null,
            pvc_url: body.pvc_url || null,
            lga_id: body.lga_id,
            ward_id: body.ward_id,
            polling_unit_id: body.polling_unit_id,
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
                data: { lga_id: body.lga_id, ward_id: body.ward_id, polling_unit_id: body.polling_unit_id },
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

// Admin verification
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

        await prisma.$transaction(async (tx) => {
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
        });

        res.json({ ok: true });
    })
);

export default router;
