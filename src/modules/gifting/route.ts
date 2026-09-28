import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';
import { requireFeature } from '../../middleware/tenants';

const router = Router();
router.use(requireFeature('gifting'));

const filterSchema = z.object({
    lga_id: z.number().int().optional(),
    ward_id: z.number().int().optional(),
    level_id: z.string().uuid().optional(),
});
type GiftFilter = z.infer<typeof filterSchema>;

const createBatch = z.object({
    type: z.enum(['cash', 'data', 'airtime']),
    amount_kobo: z.number().int().positive(),
    filter: filterSchema,
});

const recipientWhere = (tenant_id: string, f: GiftFilter) => ({
    tenant_id,
    status: 'verified',
    ...(f.lga_id ? { lga_id: f.lga_id } : {}),
    ...(f.ward_id ? { ward_id: f.ward_id } : {}),
    ...(f.level_id ? { level_id: f.level_id } : {}),
});

router.post(
    '/batches',
    requireAuth,
    requireRole('tenant_admin', 'treasurer'),
    asyncHandler(async (req, res) => {
        const body = createBatch.parse(req.body);
        const tenant_id = req.tenant!.id;

        const recipientCount = await prisma.tenantMember.count({ where: recipientWhere(tenant_id, body.filter) });
        if (recipientCount === 0) throw { status: 400, message: 'No verified members match this filter' };

        const batch = await prisma.giftBatch.create({
            data: {
                tenant_id,
                created_by: req.user!.id,
                type: body.type,
                total_amount_kobo: BigInt(recipientCount) * BigInt(body.amount_kobo),
                recipient_count: recipientCount,
                // The per-recipient amount is stored in the filter so approval uses exactly what was created
                filter_json: { ...body.filter, amount_kobo: body.amount_kobo },
                status: 'pending_approval',
            },
            select: { id: true, status: true, total_amount_kobo: true, recipient_count: true, created_at: true },
        });

        res.status(201).json({ batch });
    })
);

router.post(
    '/batches/:id/approve',
    requireAuth,
    requireRole('treasurer'),
    asyncHandler(async (req, res) => {
        const batchId = String(req.params.id);
        const tenant_id = req.tenant!.id;
        const actorId = req.user!.id;

        await prisma.$transaction(
            async (tx) => {
                // Row lock so two approvers can't process the same batch
                const locked = await tx.$queryRaw<{ id: string }[]>`
                    SELECT id FROM gift_batches WHERE id = ${batchId} AND tenant_id = ${tenant_id} FOR UPDATE`;
                if (!locked.length) throw { status: 404, message: 'Batch not found' };

                const batch = await tx.giftBatch.findUniqueOrThrow({ where: { id: batchId } });
                if (batch.status !== 'pending_approval') throw { status: 400, message: `Batch is ${batch.status}` };
                if (batch.created_by === actorId) {
                    throw { status: 403, message: 'A batch must be approved by someone other than its creator' };
                }

                const { amount_kobo, ...filter } = (batch.filter_json ?? {}) as GiftFilter & { amount_kobo: number };
                const amount = BigInt(amount_kobo);

                const recipients = await tx.tenantMember.findMany({
                    where: recipientWhere(tenant_id, filter),
                    select: { id: true },
                });
                // The approver signed off on a specific recipient count / total; refuse if it drifted.
                if (recipients.length !== batch.recipient_count) {
                    throw {
                        status: 409,
                        message: `Recipient list changed since creation (${batch.recipient_count} -> ${recipients.length}). Create a new batch.`,
                    };
                }

                const isCash = batch.type === 'cash';
                for (const r of recipients) {
                    if (isCash) {
                        // Atomic credit: creates the wallet on first gift, otherwise increments
                        const wallet = await tx.wallet.upsert({
                            where: { tenant_id_member_id: { tenant_id, member_id: r.id } },
                            create: { tenant_id, member_id: r.id, balance_kobo: amount },
                            update: { balance_kobo: { increment: amount } },
                        });
                        await tx.walletTransaction.create({
                            data: {
                                tenant_id,
                                wallet_id: wallet.id,
                                type: 'credit',
                                amount_kobo: amount,
                                balance_after: wallet.balance_kobo,
                                reference: `GIFT-${batchId}-${r.id}`,
                                source: 'gift',
                                source_id: batchId,
                                narration: 'Campaign empowerment',
                            },
                        });
                    }
                }

                // Cash is credited above; data/airtime stay pending until a VTU provider confirms
                await tx.gift.createMany({
                    data: recipients.map((r) => ({
                        tenant_id,
                        batch_id: batchId,
                        recipient_member_id: r.id,
                        type: batch.type,
                        amount_kobo: amount,
                        status: isCash ? 'success' : 'pending',
                    })),
                });

                await tx.giftBatch.update({
                    where: { id: batchId },
                    data: { status: isCash ? 'completed' : 'processing', approved_by: actorId, approved_at: new Date() },
                });

                await tx.auditLog.create({
                    data: {
                        tenant_id,
                        actor_user_id: actorId,
                        action: 'gift.approve',
                        entity_type: 'gift_batch',
                        entity_id: batchId,
                        after_data: { recipients: recipients.length },
                    },
                });
            },
            { timeout: 120_000, maxWait: 10_000 }
        );

        res.json({ ok: true });
    })
);

router.get(
    '/batches',
    requireAuth,
    requireRole('tenant_admin', 'treasurer'),
    asyncHandler(async (req, res) => {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const batches = await prisma.giftBatch.findMany({
            where: { tenant_id: req.tenant!.id, ...(status ? { status } : {}) },
            orderBy: { created_at: 'desc' },
            take: 100,
            select: {
                id: true, type: true, status: true, total_amount_kobo: true, recipient_count: true,
                filter_json: true, created_at: true, approved_at: true,
                creator: { select: { id: true, full_name: true } },
                approver: { select: { id: true, full_name: true } },
            },
        });
        res.json({ batches });
    })
);

router.post(
    '/batches/:id/reject',
    requireAuth,
    requireRole('tenant_admin', 'treasurer'),
    asyncHandler(async (req, res) => {
        const batchId = String(req.params.id);
        const tenant_id = req.tenant!.id;
        const { count } = await prisma.giftBatch.updateMany({
            where: { id: batchId, tenant_id, status: 'pending_approval' },
            data: { status: 'rejected', approved_by: req.user!.id, approved_at: new Date() },
        });
        if (!count) throw { status: 404, message: 'Pending batch not found' };
        await prisma.auditLog.create({
            data: { tenant_id, actor_user_id: req.user!.id, action: 'gift.reject', entity_type: 'gift_batch', entity_id: batchId },
        });
        res.json({ ok: true });
    })
);

router.get(
    '/wallet',
    requireAuth,
    asyncHandler(async (req, res) => {
        const wallet = await prisma.wallet.findUnique({
            where: { tenant_id_member_id: { tenant_id: req.tenant!.id, member_id: req.membership!.id } },
            select: {
                balance_kobo: true, currency: true,
                transactions: {
                    orderBy: { created_at: 'desc' },
                    take: 50,
                    select: { id: true, type: true, amount_kobo: true, balance_after: true, narration: true, created_at: true },
                },
            },
        });
        res.json({ wallet: wallet ?? { balance_kobo: 0, currency: 'NGN', transactions: [] } });
    })
);

router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
        const gifts = await prisma.gift.findMany({
            where: { tenant_id: req.tenant!.id, recipient_member_id: req.membership!.id },
            orderBy: { created_at: 'desc' },
            take: 50,
            select: { id: true, type: true, amount_kobo: true, status: true, created_at: true },
        });
        res.json({ gifts });
    })
);

export default router;
