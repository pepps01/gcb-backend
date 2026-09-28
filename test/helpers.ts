import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/db';

export const app = createApp();
export { prisma };

const FEATURES = ['gifting', 'situation_room', 'messaging', 'group_chat', 'broadcast'];

/** A fresh tenant with a default level. Features are enabled unless listed in `disabled`. */
export async function createTenant(opts: { disabled?: string[] } = {}) {
    const slug = `t${crypto.randomBytes(4).toString('hex')}`;
    const tenant = await prisma.tenant.create({
        data: {
            slug,
            subdomain: slug,
            name: `Tenant ${slug}`,
            branding: { create: { app_name: `App ${slug}` } },
            features: { create: FEATURES.map((feature_key) => ({ feature_key, enabled: !opts.disabled?.includes(feature_key) })) },
            levels: { create: [{ name: 'Supporter', rank: 1, is_default: true }, { name: 'Ward Leader', rank: 2 }] },
        },
        include: { levels: true },
    });
    return tenant;
}

const digits = (n: number) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');
export const newPhone = () => `+2348${digits(9)}`;

export interface Session {
    token: string;
    userId: string;
    memberId: string;
    phone: string;
    slug: string;
}

export async function register(slug: string, extra: Record<string, unknown> = {}): Promise<Session> {
    const phone = (extra.phone as string) ?? newPhone();
    const res = await request(app)
        .post('/api/auth/register')
        .set('X-Tenant-Slug', slug)
        .send({ phone, password: 'password123', full_name: 'Test User', ...extra });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.token, userId: res.body.user.id, memberId: res.body.membership.id, phone, slug };
}

/** Register a member and set role/status directly (roles aren't trusted from the token, so no re-login needed). */
export async function member(slug: string, data: { role?: string; status?: string; lga_id?: number; ward_id?: number } = {}) {
    const s = await register(slug);
    if (Object.keys(data).length) await prisma.tenantMember.update({ where: { id: s.memberId }, data });
    return s;
}

/** Request helpers bound to a session's tenant and token. */
export function as(s: Pick<Session, 'slug'> & { token?: string }) {
    const wrap = (r: request.Test) => {
        r.set('X-Tenant-Slug', s.slug);
        if (s.token) r.set('Authorization', `Bearer ${s.token}`);
        return r;
    };
    return {
        get: (p: string) => wrap(request(app).get(p)),
        post: (p: string, body?: object) => wrap(request(app).post(p)).send(body ?? {}),
        patch: (p: string, body?: object) => wrap(request(app).patch(p)).send(body ?? {}),
        put: (p: string, body?: object) => wrap(request(app).put(p)).send(body ?? {}),
        delete: (p: string) => wrap(request(app).delete(p)),
    };
}

/** Random 11-digit NIN */
export const newNin = () => digits(11);

/** Ensures an LGA → ward → polling unit chain exists in the tenant and returns its ids. */
export async function place(slug: string, lga = 'Okene', ward = 'Bariki', pu = 'PU 001') {
    const { id: tenant_id } = await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    const l = await prisma.lga.upsert({ where: { tenant_id_name: { tenant_id, name: lga } }, update: {}, create: { tenant_id, name: lga } });
    const w = await prisma.ward.upsert({ where: { lga_id_name: { lga_id: l.id, name: ward } }, update: {}, create: { tenant_id, lga_id: l.id, name: ward } });
    const p = await prisma.pollingUnit.upsert({ where: { ward_id_name: { ward_id: w.id, name: pu } }, update: {}, create: { tenant_id, ward_id: w.id, name: pu } });
    return { lga_id: l.id, ward_id: w.id, polling_unit_id: p.id };
}
