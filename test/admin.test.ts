import { beforeAll, describe, expect, it } from 'vitest';
import { as, createTenant, member, register } from './helpers';

let slug: string;

beforeAll(async () => {
    slug = (await createTenant()).slug;
});

describe('members', () => {
    it('lists and searches members for admins only', async () => {
        const s = await register(slug, { full_name: 'Zainab Searchable' });
        expect((await as(s).get('/api/members')).status).toBe(403);

        const admin = await member(slug, { role: 'tenant_admin' });
        const res = await as(admin).get('/api/members?q=Searchable');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.members[0]).toMatchObject({ id: s.memberId, user: { full_name: 'Zainab Searchable' } });
    });

    it('changes a member\'s role and level', async () => {
        const s = await register(slug);
        const admin = await member(slug, { role: 'tenant_admin' });
        const { body } = await as(admin).get('/api/levels');
        const leader = body.levels.find((l: { rank: number }) => l.rank === 2);

        const res = await as(admin).patch(`/api/members/${s.memberId}`, { role: 'treasurer', level_id: leader.id });
        expect(res.status).toBe(200);
        const me = await as(s).get('/api/auth/me');
        expect(me.body.membership).toMatchObject({ role: 'treasurer', level: { id: leader.id } });
        // The new role applies without re-login
        expect((await as(s).get('/api/gifting/batches')).status).toBe(200);
    });

    it('rejects unknown roles, foreign levels, and self role changes', async () => {
        const s = await register(slug);
        const admin = await member(slug, { role: 'tenant_admin' });
        expect((await as(admin).patch(`/api/members/${s.memberId}`, { role: 'emperor' })).status).toBe(400);
        const other = await createTenant();
        expect((await as(admin).patch(`/api/members/${s.memberId}`, { level_id: other.levels[0].id })).status).toBe(400);
        expect((await as(admin).patch(`/api/members/${admin.memberId}`, { role: 'supporter' })).status).toBe(400);
    });

    it('only tenant admins can change members, within their tenant', async () => {
        const s = await register(slug);
        const coordinator = await member(slug, { role: 'lga_coordinator' });
        expect((await as(coordinator).patch(`/api/members/${s.memberId}`, { role: 'treasurer' })).status).toBe(403);

        const otherSlug = (await createTenant()).slug;
        const foreignAdmin = await member(otherSlug, { role: 'tenant_admin' });
        expect((await as(foreignAdmin).patch(`/api/members/${s.memberId}`, { role: 'treasurer' })).status).toBe(404);
    });
});

describe('levels', () => {
    it('creates, updates and deletes levels, keeping one default', async () => {
        const admin = await member(slug, { role: 'tenant_admin' });
        const created = await as(admin).post('/api/levels', { name: 'Senator Aide', rank: 9 });
        expect(created.status).toBe(201);
        const id = created.body.level.id;

        expect((await as(admin).post('/api/levels', { name: 'Dup Rank', rank: 9 })).status).toBe(409);
        expect((await as(admin).patch(`/api/levels/${id}`, { is_default: true })).status).toBe(200);
        const { body } = await as(admin).get('/api/levels');
        expect(body.levels.filter((l: { is_default: boolean }) => l.is_default).map((l: { id: string }) => l.id)).toEqual([id]);

        expect((await as(admin).delete(`/api/levels/${id}`)).status).toBe(400); // default
        const supporter = body.levels.find((l: { rank: number }) => l.rank === 1);
        await as(admin).patch(`/api/levels/${supporter.id}`, { is_default: true });
        expect((await as(admin).delete(`/api/levels/${id}`)).status).toBe(204);
    });

    it('refuses to delete a level that has members', async () => {
        const admin = await member(slug, { role: 'tenant_admin' });
        const { body } = await as(admin).post('/api/levels', { name: 'In Use', rank: 7 });
        const s = await register(slug);
        await as(admin).patch(`/api/members/${s.memberId}`, { level_id: body.level.id });
        expect((await as(admin).delete(`/api/levels/${body.level.id}`)).status).toBe(409);
    });

    it('is read-only for non-admins', async () => {
        const s = await register(slug);
        expect((await as(s).get('/api/levels')).status).toBe(200);
        expect((await as(s).post('/api/levels', { name: 'Nope', rank: 50 })).status).toBe(403);
    });
});

describe('incidents', () => {
    const report = { type: 'vote_buying', severity: 'high', title: 'Cash at PU 004', lat: 7.8, lng: 6.7 };

    it('lets any member report and see their own reports', async () => {
        const s = await register(slug);
        const res = await as(s).post('/api/incidents', report);
        expect(res.status).toBe(201);
        const mine = await as(s).get('/api/incidents/mine');
        expect(mine.body.incidents[0]).toMatchObject({ id: res.body.incident.id, status: 'open' });
        expect((await as(s).get('/api/incidents')).status).toBe(403);
    });

    it('validates the report', async () => {
        const s = await register(slug);
        expect((await as(s).post('/api/incidents', { ...report, type: 'aliens' })).status).toBe(400);
        expect((await as(s).post('/api/incidents', { ...report, lat: 200 })).status).toBe(400);
    });

    it('lets the situation room triage incidents', async () => {
        const s = await register(slug);
        const { body } = await as(s).post('/api/incidents', report);
        const agent = await member(slug, { role: 'situation_agent' });
        const list = await as(agent).get('/api/incidents');
        expect(list.body.incidents.map((i: { id: string }) => i.id)).toContain(body.incident.id);
        expect((await as(agent).patch(`/api/incidents/${body.incident.id}`, { status: 'resolved' })).status).toBe(200);
        expect((await as(s).get('/api/incidents/mine')).body.incidents[0].status).toBe('resolved');
        expect((await as(s).patch(`/api/incidents/${body.incident.id}`, { status: 'open' })).status).toBe(403);
    });

    it('is blocked when the situation room is disabled', async () => {
        const off = (await createTenant({ disabled: ['situation_room'] })).slug;
        const s = await register(off);
        expect((await as(s).post('/api/incidents', report)).status).toBe(403);
    });
});
