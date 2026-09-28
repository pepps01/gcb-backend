import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';
import { ROLES } from '../../config/roles';
import { syncScopedConversations } from '../chat/membership';
import { disconnectMember } from '../../realtime/io';
import { assertValidLocation } from '../locations/resolve';

const router = Router();

const listQuery = z.object({
    status: z.string().optional(),
    role: z.string().optional(),
    lga_id: z.coerce.number().int().optional(),
    ward_id: z.coerce.number().int().optional(),
    level_id: z.string().uuid().optional(),
    q: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
    '/',
    requireAuth,
    requireRole('tenant_admin', 'lga_coordinator', 'treasurer'),
    asyncHandler(async (req, res) => {
        const f = listQuery.parse(req.query);
        const where = {
            tenant_id: req.tenant!.id,
            ...(f.status ? { status: f.status } : {}),
            ...(f.role ? { role: f.role } : {}),
            ...(f.lga_id ? { lga_id: f.lga_id } : {}),
            ...(f.ward_id ? { ward_id: f.ward_id } : {}),
            ...(f.level_id ? { level_id: f.level_id } : {}),
            ...(f.q ? { user: { OR: [{ full_name: { contains: f.q } }, { phone: { contains: f.q } }] } } : {}),
        };
        const [total, members] = await Promise.all([
            prisma.tenantMember.count({ where }),
            prisma.tenantMember.findMany({
                where,
                orderBy: { joined_at: 'desc' },
                skip: (f.page - 1) * f.page_size,
                take: f.page_size,
                select: {
                    id: true, role: true, status: true, referral_code: true,
                    lga_id: true, ward_id: true, polling_unit_id: true, joined_at: true, verified_at: true,
                    level: { select: { id: true, name: true, rank: true } },
                    user: { select: { id: true, phone: true, full_name: true } },
                    _count: { select: { referrals: true } },
                },
            }),
        ]);
        res.json({ total, page: f.page, page_size: f.page_size, members });
    })
);

// The caller's own referrals
router.get(
    '/me/referrals',
    requireAuth,
    asyncHandler(async (req, res) => {
        const referrals = await prisma.tenantMember.findMany({
            where: { tenant_id: req.tenant!.id, referred_by: req.membership!.id },
            orderBy: { joined_at: 'desc' },
            take: 200,
            select: { id: true, status: true, joined_at: true, user: { select: { full_name: true } } },
        });
        res.json({ referrals });
    })
);

// ---------- the caller's own profile (verification wizard) ----------

const meSchema = z
    .object({
        full_name: z.string().trim().min(2).max(200).optional(),
        lga_id: z.number().int().optional(),
        ward_id: z.number().int().optional(),
        polling_unit_id: z.number().int().optional(),
        referral_code: z.string().trim().min(3).max(12).optional(),
    })
    .refine((b) => [b.lga_id, b.ward_id, b.polling_unit_id].every((v) => v === undefined) || [b.lga_id, b.ward_id, b.polling_unit_id].every((v) => v !== undefined), {
        message: 'Send lga_id, ward_id and polling_unit_id together',
    });

router.patch(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
        const body = meSchema.parse(req.body);
        const tenant_id = req.tenant!.id;
        const member_id = req.membership!.id;
        const data: { lga_id?: number; ward_id?: number; polling_unit_id?: number; referred_by?: string } = {};

        if (body.lga_id !== undefined) {
            // The location is part of what reviewers verify, so it is fixed once submitted
            const live = await prisma.kycSubmission.findFirst({
                where: { tenant_id, member_id, status: { in: ['pending', 'verified'] } },
                select: { status: true },
            });
            if (live) throw { status: 409, message: `Your location can't change while verification is ${live.status}` };
            await assertValidLocation(tenant_id, body.lga_id, body.ward_id!, body.polling_unit_id!);
            Object.assign(data, { lga_id: body.lga_id, ward_id: body.ward_id, polling_unit_id: body.polling_unit_id });
        }

        if (body.referral_code) {
            const me = await prisma.tenantMember.findUniqueOrThrow({ where: { id: member_id }, select: { referred_by: true, referral_code: true } });
            if (me.referred_by) throw { status: 409, message: 'You already have a referrer' };
            const referrer = await prisma.tenantMember.findFirst({
                where: { tenant_id, referral_code: body.referral_code.toUpperCase() },
                select: { id: true },
            });
            if (!referrer || referrer.id === member_id) throw { status: 400, message: 'Unknown referral code' };
            data.referred_by = referrer.id;
        }

        if (body.full_name) await prisma.user.update({ where: { id: req.user!.id }, data: { full_name: body.full_name } });
        if (Object.keys(data).length) await prisma.tenantMember.update({ where: { id: member_id }, data });
        res.json({ ok: true });
    })
);

const bankSchema = z.object({
    bank_name: z.string().trim().min(2).max(100),
    account_number: z.string().regex(/^\d{10}$/, 'Account number must be 10 digits (NUBAN)'),
    account_name: z.string().trim().min(2).max(200),
});
const bankSelect = { bank_name: true, account_number: true, account_name: true, updated_at: true } as const;

router.get(
    '/me/bank',
    requireAuth,
    asyncHandler(async (req, res) => {
        const bank = await prisma.bankAccount.findUnique({ where: { member_id: req.membership!.id }, select: bankSelect });
        res.json({ bank });
    })
);

router.put(
    '/me/bank',
    requireAuth,
    asyncHandler(async (req, res) => {
        const body = bankSchema.parse(req.body);
        const member_id = req.membership!.id;
        const bank = await prisma.bankAccount.upsert({
            where: { member_id },
            create: { member_id, tenant_id: req.tenant!.id, ...body },
            update: body,
            select: bankSelect,
        });
        res.json({ bank });
    })
);

// Payout details for treasurers; every view is audited
router.get(
    '/:id/bank',
    requireAuth,
    requireRole('tenant_admin', 'treasurer'),
    asyncHandler(async (req, res) => {
        const tenant_id = req.tenant!.id;
        const member_id = String(req.params.id);
        const bank = await prisma.bankAccount.findFirst({ where: { member_id, tenant_id }, select: bankSelect });
        await prisma.auditLog.create({
            data: { tenant_id, actor_user_id: req.user!.id, action: 'member.bank.view', entity_type: 'tenant_member', entity_id: member_id },
        });
        res.json({ bank });
    })
);

const patchSchema = z
    .object({
        role: z.enum(ROLES).optional(),
        level_id: z.string().uuid().nullable().optional(),
        status: z.enum(['pending', 'verified', 'rejected', 'banned']).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

router.patch(
    '/:id',
    requireAuth,
    requireRole('tenant_admin'),
    asyncHandler(async (req, res) => {
        const body = patchSchema.parse(req.body);
        const tenant_id = req.tenant!.id;
        const id = String(req.params.id);
        if (id === req.membership!.id && (body.role || body.status)) {
            throw { status: 400, message: 'You cannot change your own role or status' };
        }
        if (body.level_id) {
            const level = await prisma.level.findFirst({ where: { id: body.level_id, tenant_id }, select: { id: true } });
            if (!level) throw { status: 400, message: 'Unknown level' };
        }

        const { count } = await prisma.tenantMember.updateMany({ where: { id, tenant_id }, data: body });
        if (!count) throw { status: 404, message: 'Member not found' };
        if (body.status) {
            if (body.status === 'banned') disconnectMember(id);
            await syncScopedConversations(tenant_id, req.tenant!.features, id);
        }
        await prisma.auditLog.create({
            data: {
                tenant_id,
                actor_user_id: req.user!.id,
                action: 'member.update',
                entity_type: 'tenant_member',
                entity_id: id,
                after_data: body,
            },
        });
        res.json({ ok: true });
    })
);

export default router;
