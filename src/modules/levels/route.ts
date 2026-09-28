import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

const levelSelect = { id: true, name: true, rank: true, description: true, is_default: true } as const;

router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
        const levels = await prisma.level.findMany({
            where: { tenant_id: req.tenant!.id },
            orderBy: { rank: 'asc' },
            select: { ...levelSelect, _count: { select: { members: true } } },
        });
        res.json({ levels });
    })
);

const levelSchema = z.object({
    name: z.string().min(2).max(60),
    rank: z.number().int().min(1),
    description: z.string().max(255).nullable().optional(),
    is_default: z.boolean().optional(),
});

router.post(
    '/',
    requireAuth,
    requireRole('tenant_admin'),
    asyncHandler(async (req, res) => {
        const body = levelSchema.parse(req.body);
        const tenant_id = req.tenant!.id;
        const level = await prisma.$transaction(async (tx) => {
            // Only one default level per tenant
            if (body.is_default) await tx.level.updateMany({ where: { tenant_id }, data: { is_default: false } });
            return tx.level.create({ data: { ...body, tenant_id }, select: levelSelect });
        });
        res.status(201).json({ level });
    })
);

router.patch(
    '/:id',
    requireAuth,
    requireRole('tenant_admin'),
    asyncHandler(async (req, res) => {
        const body = levelSchema.partial().parse(req.body);
        const tenant_id = req.tenant!.id;
        const id = String(req.params.id);
        await prisma.$transaction(async (tx) => {
            const level = await tx.level.findFirst({ where: { id, tenant_id }, select: { is_default: true } });
            if (!level) throw { status: 404, message: 'Level not found' };
            if (body.is_default === false && level.is_default) {
                throw { status: 400, message: 'Make another level the default instead' };
            }
            if (body.is_default) await tx.level.updateMany({ where: { tenant_id }, data: { is_default: false } });
            await tx.level.update({ where: { id }, data: body });
        });
        res.json({ ok: true });
    })
);

router.delete(
    '/:id',
    requireAuth,
    requireRole('tenant_admin'),
    asyncHandler(async (req, res) => {
        const tenant_id = req.tenant!.id;
        const id = String(req.params.id);
        const level = await prisma.level.findFirst({
            where: { id, tenant_id },
            select: { is_default: true, _count: { select: { members: true } } },
        });
        if (!level) throw { status: 404, message: 'Level not found' };
        if (level.is_default) throw { status: 400, message: 'Cannot delete the default level' };
        if (level._count.members) throw { status: 409, message: 'Level still has members; move them first' };
        await prisma.level.delete({ where: { id } });
        res.status(204).end();
    })
);

export default router;
