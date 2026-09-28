import { beforeAll, describe, expect, it } from 'vitest';
import { as, createTenant, member, newNin, place, prisma, register } from './helpers';

let slug: string;
let loc: Awaited<ReturnType<typeof place>>;
const kyc = (nin = newNin()) => ({ nin, vin: '90F5B1234567890', ...loc });

beforeAll(async () => {
    slug = (await createTenant()).slug;
    loc = await place(slug);
});

describe('kyc', () => {
    it('submits, shows pending, and blocks a second live submission', async () => {
        const s = await register(slug);
        expect((await as(s).post('/api/kyc/submit', kyc())).status).toBe(201);
        const me = await as(s).get('/api/kyc/me');
        expect(me.body.submission.status).toBe('pending');
        expect((await as(s).post('/api/kyc/submit', kyc())).status).toBe(409);

        const m = await prisma.tenantMember.findUnique({ where: { id: s.memberId } });
        expect(m).toMatchObject(loc);
    });

    it('stores NIN/VIN only as hashes', async () => {
        const s = await register(slug);
        const nin = newNin();
        await as(s).post('/api/kyc/submit', kyc(nin));
        const row = await prisma.kycSubmission.findFirst({ where: { member_id: s.memberId } });
        expect(row!.nin_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(row)).not.toContain(nin);
    });

    it('refuses a NIN already used by another member', async () => {
        const nin = newNin();
        const a = await register(slug);
        const b = await register(slug);
        expect((await as(a).post('/api/kyc/submit', kyc(nin))).status).toBe(201);
        expect((await as(b).post('/api/kyc/submit', kyc(nin))).status).toBe(409);
    });

    it('lets only reviewers list and review', async () => {
        const supporter = await register(slug);
        expect((await as(supporter).get('/api/kyc/submissions')).status).toBe(403);

        const admin = await member(slug, { role: 'lga_coordinator' });
        const res = await as(admin).get('/api/kyc/submissions');
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/nin_hash|vin_hash/);
    });

    it('verifies a member through review', async () => {
        const s = await register(slug);
        await as(s).post('/api/kyc/submit', kyc());
        const admin = await member(slug, { role: 'tenant_admin' });
        const { body } = await as(admin).get('/api/kyc/submissions');
        const sub = body.submissions.find((x: { member: { id: string } }) => x.member.id === s.memberId);

        expect((await as(admin).post('/api/kyc/review', { submission_id: sub.id, decision: 'verified' })).status).toBe(200);
        const me = await as(s).get('/api/auth/me');
        expect(me.body.membership.status).toBe('verified');
        // Already reviewed
        expect((await as(admin).post('/api/kyc/review', { submission_id: sub.id, decision: 'rejected' })).status).toBe(404);
    });

    it('lets a rejected member resubmit with the same NIN', async () => {
        const s = await register(slug);
        const nin = newNin();
        await as(s).post('/api/kyc/submit', kyc(nin));
        const admin = await member(slug, { role: 'tenant_admin' });
        const sub = await prisma.kycSubmission.findFirstOrThrow({ where: { member_id: s.memberId } });
        await as(admin).post('/api/kyc/review', { submission_id: sub.id, decision: 'rejected', reason: 'Blurry PVC' });

        const me = await as(s).get('/api/kyc/me');
        expect(me.body.submission).toMatchObject({ status: 'rejected', rejection_reason: 'Blurry PVC' });
        expect((await as(s).post('/api/kyc/submit', kyc(nin))).status).toBe(201);
        expect((await as(s).get('/api/kyc/me')).body.submission.status).toBe('pending');
    });

    it('does not review a submission from another tenant', async () => {
        const other = (await createTenant()).slug;
        const s = await register(other);
        await as(s).post('/api/kyc/submit', { ...kyc(), ...(await place(other)) });
        const sub = await prisma.kycSubmission.findFirstOrThrow({ where: { member_id: s.memberId } });
        const admin = await member(slug, { role: 'tenant_admin' });
        expect((await as(admin).post('/api/kyc/review', { submission_id: sub.id, decision: 'verified' })).status).toBe(404);
    });
});
