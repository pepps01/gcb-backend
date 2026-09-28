import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, createTenant, newPhone, prisma, register } from './helpers';

let slug: string;
let otherSlug: string;

beforeAll(async () => {
    slug = (await createTenant()).slug;
    otherSlug = (await createTenant()).slug;
});

describe('tenancy', () => {
    it('serves /health without a tenant', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
    });

    it('404s an unknown tenant', async () => {
        const res = await as({ slug: 'nope-nope' }).get('/api/tenant/current');
        expect(res.status).toBe(404);
    });

    it('returns branding and features for the current tenant', async () => {
        const res = await as({ slug }).get('/api/tenant/current');
        expect(res.status).toBe(200);
        expect(res.body.slug).toBe(slug);
        expect(res.body.branding.app_name).toBe(`App ${slug}`);
        expect(res.body.features.gifting.enabled).toBe(true);
    });
});

describe('register / login / me', () => {
    it('registers with the default level and a referral code, normalising the phone', async () => {
        const local = `080${newPhone().slice(-8)}`;
        const res = await as({ slug }).post('/api/auth/register', { phone: local, password: 'password123', full_name: 'Ada' });
        expect(res.status).toBe(201);
        expect(res.body.user.phone).toBe(`+234${local.slice(1)}`);
        expect(res.body.membership).toMatchObject({ role: 'supporter', status: 'pending', level: { name: 'Supporter', rank: 1 } });
    });

    it('rejects invalid input', async () => {
        const res = await as({ slug }).post('/api/auth/register', { phone: 'abc', password: 'short', full_name: 'A' });
        expect(res.status).toBe(400);
    });

    it('logs in and returns /me with referral code', async () => {
        const s = await register(slug);
        const login = await as({ slug }).post('/api/auth/login', { phone: s.phone, password: 'password123' });
        expect(login.status).toBe(200);
        const me = await as({ slug, token: login.body.token }).get('/api/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.user.phone).toBe(s.phone);
        expect(me.body.membership.referral_code).toMatch(/^GCB/);
        expect(me.body.membership.level.name).toBe('Supporter');
    });

    it('rejects a wrong password with a generic error', async () => {
        const s = await register(slug);
        const bad = await as({ slug }).post('/api/auth/login', { phone: s.phone, password: 'wrong-password' });
        const unknown = await as({ slug }).post('/api/auth/login', { phone: newPhone(), password: 'wrong-password' });
        expect(bad.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(bad.body.error).toBe(unknown.body.error);
    });

    it('refuses a duplicate registration in the same tenant', async () => {
        const s = await register(slug);
        const res = await as({ slug }).post('/api/auth/register', { phone: s.phone, password: 'password123', full_name: 'Again' });
        expect(res.status).toBe(409);
    });

    it('joins an existing user to another tenant only with the right password', async () => {
        const s = await register(slug);
        const wrong = await as({ slug: otherSlug }).post('/api/auth/register', { phone: s.phone, password: 'not-the-password', full_name: 'X Y' });
        expect(wrong.status).toBe(409);
        const ok = await as({ slug: otherSlug }).post('/api/auth/register', { phone: s.phone, password: 'password123', full_name: 'X Y' });
        expect(ok.status).toBe(201);
        expect(ok.body.user.id).toBe(s.userId);
    });

    it('refuses login to a tenant the user has not joined', async () => {
        const s = await register(slug);
        const res = await as({ slug: otherSlug }).post('/api/auth/login', { phone: s.phone, password: 'password123' });
        expect(res.status).toBe(403);
    });

    it('rejects a token from another tenant, even for a member of both', async () => {
        const s = await register(slug);
        await register(otherSlug, { phone: s.phone });
        const res = await as({ slug: otherSlug, token: s.token }).get('/api/auth/me');
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/tenant/);
    });

    it('rejects missing and forged tokens', async () => {
        expect((await as({ slug }).get('/api/auth/me')).status).toBe(401);
        expect((await as({ slug, token: 'abc.def.ghi' }).get('/api/auth/me')).status).toBe(401);
    });

    it('blocks banned members', async () => {
        const s = await register(slug);
        await prisma.tenantMember.update({ where: { id: s.memberId }, data: { status: 'banned' } });
        expect((await as(s).get('/api/auth/me')).status).toBe(403);
        expect((await as({ slug }).post('/api/auth/login', { phone: s.phone, password: 'password123' })).status).toBe(403);
    });

    it('links referrals and lists them for the referrer', async () => {
        const referrer = await register(slug);
        const { body } = await as(referrer).get('/api/auth/me');
        const child = await register(slug, { referral_code: body.membership.referral_code });
        const res = await as(referrer).get('/api/members/me/referrals');
        expect(res.status).toBe(200);
        expect(res.body.referrals.map((r: { id: string }) => r.id)).toContain(child.memberId);
    });
});
