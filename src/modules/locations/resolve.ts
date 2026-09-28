import { prisma } from '../../config/db';

export interface LocationIds { lga_id?: number | null; ward_id?: number | null; polling_unit_id?: number | null }

/** Names for whichever ids are given (null when unknown to this tenant). */
export async function resolveLocation(tenant_id: string, ids: LocationIds) {
    const [lga, ward, pu] = await Promise.all([
        ids.lga_id ? prisma.lga.findFirst({ where: { id: ids.lga_id, tenant_id }, select: { name: true } }) : null,
        ids.ward_id ? prisma.ward.findFirst({ where: { id: ids.ward_id, tenant_id }, select: { name: true } }) : null,
        ids.polling_unit_id
            ? prisma.pollingUnit.findFirst({ where: { id: ids.polling_unit_id, tenant_id }, select: { name: true, code: true } })
            : null,
    ]);
    return {
        lga_name: lga?.name ?? null,
        ward_name: ward?.name ?? null,
        polling_unit_name: pu ? (pu.code ? `${pu.code} · ${pu.name}` : pu.name) : null,
    };
}

/** Throws 400 unless the polling unit is in the ward, the ward in the LGA, all in this tenant. */
export async function assertValidLocation(tenant_id: string, lga_id: number, ward_id: number, polling_unit_id: number) {
    const pu = await prisma.pollingUnit.findFirst({
        where: { id: polling_unit_id, tenant_id, ward_id, ward: { lga_id } },
        select: { id: true },
    });
    if (!pu) throw { status: 400, message: 'Choose a valid LGA, ward and polling unit' };
}

/** Batch version of resolveLocation for lists: adds lga_name / ward_name / polling_unit_name to each row. */
export async function withLocationNames<T extends LocationIds>(tenant_id: string, rows: T[]) {
    const ids = (k: keyof LocationIds) => [...new Set(rows.map((r) => r[k]).filter((v): v is number => !!v))];
    const [lgas, wards, pus] = await Promise.all([
        prisma.lga.findMany({ where: { tenant_id, id: { in: ids('lga_id') } }, select: { id: true, name: true } }),
        prisma.ward.findMany({ where: { tenant_id, id: { in: ids('ward_id') } }, select: { id: true, name: true } }),
        prisma.pollingUnit.findMany({ where: { tenant_id, id: { in: ids('polling_unit_id') } }, select: { id: true, name: true, code: true } }),
    ]);
    const lga = new Map(lgas.map((l) => [l.id, l.name]));
    const ward = new Map(wards.map((w) => [w.id, w.name]));
    const pu = new Map(pus.map((p) => [p.id, p.code ? `${p.code} · ${p.name}` : p.name]));
    return rows.map((r) => ({
        ...r,
        lga_name: (r.lga_id && lga.get(r.lga_id)) || null,
        ward_name: (r.ward_id && ward.get(r.ward_id)) || null,
        polling_unit_name: (r.polling_unit_id && pu.get(r.polling_unit_id)) || null,
    }));
}
