import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

const createSchema = z.object({
    type: z.enum(['security_threat', 'vote_buying', 'violence', 'bvas_issue', 'logistics', 'other']),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    title: z.string().min(3),
    description: z.string().optional(),
    media_urls: z.array(z.string().url()).default([]),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    lga_id: z.number().int().optional(),
    ward_id: z.number().int().optional(),
    polling_unit_id: z.number().int().optional(),
});

router.post(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
        const b = createSchema.parse(req.body);
        const hasPoint = b.lat != null && b.lng != null;

        const incident = await prisma.incident.create({
            data: {
                tenant_id: req.tenant!.id,
                reporter_member_id: req.membership!.id,
                type: b.type,
                severity: b.severity,
                title: b.title,
                description: b.description ?? null,
                media_urls: b.media_urls,
                lat: hasPoint ? b.lat : null,
                lng: hasPoint ? b.lng : null,
                lga_id: b.lga_id ?? null,
                ward_id: b.ward_id ?? null,
                polling_unit_id: b.polling_unit_id ?? null,
                status: 'open',
            },
            select: { id: true, status: true, created_at: true },
        });

        res.status(201).json({ incident });
    })
);

router.get(
    '/',
    requireAuth,
    requireRole('tenant_admin', 'lga_coordinator', 'situation_agent'),
    asyncHandler(async (req, res) => {
        const incidents = await prisma.incident.findMany({
            where: { tenant_id: req.tenant!.id },
            orderBy: { created_at: 'desc' },
            take: 200,
            select: {
                id: true, type: true, severity: true, title: true, status: true,
                lga_id: true, ward_id: true, polling_unit_id: true,
                lat: true, lng: true, created_at: true,
            },
        });
        res.json({ incidents });
    })
);

export default router;
