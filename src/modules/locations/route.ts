import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveLocation } from './resolve';

const router = Router();
router.use(requireAuth);

const intParam = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw { status: 400, message: 'Invalid id' };
    return n;
};

router.get(
    '/lgas',
    asyncHandler(async (req, res) => {
        const lgas = await prisma.lga.findMany({
            where: { tenant_id: req.tenant!.id },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, code: true, _count: { select: { wards: true } } },
        });
        res.json({ lgas });
    })
);

router.get(
    '/lgas/:id/wards',
    asyncHandler(async (req, res) => {
        const wards = await prisma.ward.findMany({
            where: { tenant_id: req.tenant!.id, lga_id: intParam(req.params.id) },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, code: true, _count: { select: { polling_units: true } } },
        });
        res.json({ wards });
    })
);

router.get(
    '/wards/:id/polling-units',
    asyncHandler(async (req, res) => {
        const polling_units = await prisma.pollingUnit.findMany({
            where: { tenant_id: req.tenant!.id, ward_id: intParam(req.params.id) },
            orderBy: [{ code: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
            select: { id: true, name: true, code: true },
        });
        res.json({ polling_units });
    })
);

/** Names for a set of ids, e.g. to label a member's location. */
router.get(
    '/resolve',
    asyncHandler(async (req, res) => {
        const q = z.object({
            lga_id: z.coerce.number().int().optional(),
            ward_id: z.coerce.number().int().optional(),
            polling_unit_id: z.coerce.number().int().optional(),
        }).parse(req.query);
        res.json(await resolveLocation(req.tenant!.id, q));
    })
);

const row = z.object({
    lga: z.string().trim().min(1).max(100),
    ward: z.string().trim().min(1).max(100),
    polling_unit: z.string().trim().min(1).max(200),
    ward_code: z.string().trim().max(20).optional(),
    pu_code: z.string().trim().max(30).optional(),
});

/**
 * Bulk import (one row per polling unit), matched by name so re-importing is safe.
 * Meant for the official INEC list of the campaign's constituency.
 */
router.post(
    '/import',
    requireRole('tenant_admin'),
    asyncHandler(async (req, res) => {
        const { rows } = z.object({ rows: z.array(row).min(1).max(20_000) }).parse(req.body);
        const tenant_id = req.tenant!.id;
        const counts = { lgas: 0, wards: 0, polling_units: 0 };

        await prisma.$transaction(
            async (tx) => {
                const lgaIds = new Map((await tx.lga.findMany({ where: { tenant_id } })).map((l) => [l.name.toLowerCase(), l.id]));
                const wardIds = new Map(
                    (await tx.ward.findMany({ where: { tenant_id } })).map((w) => [`${w.lga_id}|${w.name.toLowerCase()}`, w.id])
                );
                const puKeys = new Set(
                    (await tx.pollingUnit.findMany({ where: { tenant_id }, select: { ward_id: true, name: true } }))
                        .map((p) => `${p.ward_id}|${p.name.toLowerCase()}`)
                );

                for (const r of rows) {
                    let lga_id = lgaIds.get(r.lga.toLowerCase());
                    if (!lga_id) {
                        lga_id = (await tx.lga.create({ data: { tenant_id, name: r.lga } })).id;
                        lgaIds.set(r.lga.toLowerCase(), lga_id);
                        counts.lgas++;
                    }
                    const wardKey = `${lga_id}|${r.ward.toLowerCase()}`;
                    let ward_id = wardIds.get(wardKey);
                    if (!ward_id) {
                        ward_id = (await tx.ward.create({ data: { tenant_id, lga_id, name: r.ward, code: r.ward_code || null } })).id;
                        wardIds.set(wardKey, ward_id);
                        counts.wards++;
                    }
                    const puKey = `${ward_id}|${r.polling_unit.toLowerCase()}`;
                    if (!puKeys.has(puKey)) {
                        await tx.pollingUnit.create({ data: { tenant_id, ward_id, name: r.polling_unit, code: r.pu_code || null } });
                        puKeys.add(puKey);
                        counts.polling_units++;
                    }
                }
                await tx.auditLog.create({
                    data: { tenant_id, actor_user_id: req.user!.id, action: 'locations.import', after_data: { rows: rows.length, ...counts } },
                });
            },
            { timeout: 120_000 }
        );
        res.json({ created: counts });
    })
);

export default router;
