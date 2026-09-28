import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { Prisma } from '../../generated/prisma/client';
import { asyncHandler } from '../../utils/async';
import { signToken, requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { normalizePhone } from '../../utils/phone';
import { withLocationNames } from '../locations/resolve';

const router = Router();

const registerSchema = z.object({
    phone: z.string().regex(/^\+?[0-9]{10,15}$/),
    password: z.string().min(8),
    full_name: z.string().min(2),
    email: z.string().email().optional(),
    referral_code: z.string().optional(),
});

// Compared against when the phone is unknown so login timing doesn't reveal which phones exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const newReferralCode = () => `GCB${crypto.randomBytes(5).toString('hex').slice(0, 7).toUpperCase()}`;

const levelSelect = { select: { id: true, name: true, rank: true } } as const;
const memberSelect = { id: true, role: true, level: levelSelect, status: true } as const;

/**
 * POST /api/auth/register
 * Creates a user and attaches them to the current tenant. If the phone already has an
 * account (e.g. from another tenant), the caller must prove ownership with that account's
 * password before being attached. In production, OTP verification is required before this step.
 */
router.post(
    '/register',
    authLimiter,
    asyncHandler(async (req, res) => {
        const body = registerSchema.parse(req.body);
        const phone = normalizePhone(body.phone);
        const tenant = req.tenant!;

        const existing = await prisma.user.findUnique({
            where: { phone },
            select: { id: true, password_hash: true },
        });
        let userId: string;
        if (existing) {
            const ok = existing.password_hash && (await bcrypt.compare(body.password, existing.password_hash));
            if (!ok) throw { status: 409, message: 'Phone already registered. Log in, or use the password of that existing account.' };
            userId = existing.id;
        } else {
            // phone_verified_at stays NULL until OTP verification exists
            const created = await prisma.user.create({
                data: {
                    phone,
                    password_hash: await bcrypt.hash(body.password, 10),
                    full_name: body.full_name,
                    email: body.email || null,
                },
                select: { id: true },
            });
            userId = created.id;
        }

        let referrerMemberId: string | null = null;
        if (body.referral_code) {
            const r = await prisma.tenantMember.findFirst({
                where: { tenant_id: tenant.id, referral_code: body.referral_code },
                select: { id: true },
            });
            referrerMemberId = r?.id ?? null;
        }

        const defaultLevel = await prisma.level.findFirst({
            where: { tenant_id: tenant.id, is_default: true },
            select: { id: true },
        });

        let member: Prisma.TenantMemberGetPayload<{ select: typeof memberSelect }> | undefined;
        for (let attempt = 0; attempt < 5 && !member; attempt++) {
            try {
                member = await prisma.tenantMember.create({
                    data: {
                        tenant_id: tenant.id,
                        user_id: userId,
                        role: 'supporter',
                        level_id: defaultLevel?.id ?? null,
                        referral_code: newReferralCode(),
                        referred_by: referrerMemberId,
                        status: 'pending',
                    },
                    select: memberSelect,
                });
            } catch (e: any) {
                if (e.code !== 'P2002') throw e;
                if (JSON.stringify(e.meta ?? {}).includes('referral_code')) continue; // code collision: retry
                throw { status: 409, message: 'You are already registered with this tenant' };
            }
        }
        if (!member) throw new Error('Could not allocate a referral code');

        const token = signToken({ sub: userId, phone, tenant_id: tenant.id, role: member.role });

        res.status(201).json({
            token,
            user: { id: userId, phone, full_name: body.full_name },
            membership: member,
            tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        });
    })
);

const loginSchema = z.object({
    phone: z.string(),
    password: z.string(),
});

router.post(
    '/login',
    authLimiter,
    asyncHandler(async (req, res) => {
        const body = loginSchema.parse(req.body);
        const phone = normalizePhone(body.phone);
        const tenant = req.tenant!;

        const user = await prisma.user.findUnique({
            where: { phone },
            select: { id: true, password_hash: true },
        });
        const ok = await bcrypt.compare(body.password, user?.password_hash || DUMMY_HASH);
        if (!user || !user.password_hash || !ok) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const membership = await prisma.tenantMember.findUnique({
            where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: user.id } },
            select: memberSelect,
        });
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this tenant' });
        }
        if (membership.status === 'banned') {
            return res.status(403).json({ error: 'Account banned' });
        }

        const token = signToken({ sub: user.id, phone, tenant_id: tenant.id, role: membership.role });

        res.json({ token, membership });
    })
);

router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { id: true, phone: true, email: true, full_name: true, photo_url: true, preferred_lang: true, status: true },
        });
        const membership = await prisma.tenantMember.findUnique({
            where: { id: req.membership!.id },
            select: { ...memberSelect, referral_code: true, referred_by: true, lga_id: true, ward_id: true, polling_unit_id: true },
        });
        const [located] = await withLocationNames(req.tenant!.id, [membership!]);
        const has_bank = !!(await prisma.bankAccount.findUnique({ where: { member_id: req.membership!.id }, select: { member_id: true } }));
        res.json({ user, membership: { ...located, has_bank, referred: !!located.referred_by }, tenant: { id: req.tenant!.id, slug: req.tenant!.slug } });
    })
);

export default router;
