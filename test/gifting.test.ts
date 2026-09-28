import { beforeAll, describe, expect, it } from 'vitest';
import { as, createTenant, member, prisma, register } from './helpers';

// Each test gets its own LGA so recipient counts don't interfere
let lga = 500;

describe('gifting', () => {
    let slug: string;
    let wardLeaderLevel: string;

    beforeAll(async () => {
        const t = await createTenant();
        slug = t.slug;
        wardLeaderLevel = t.levels.find((l) => l.rank === 2)!.id;
    });

    it('restricts batch creation to admins and treasurers', async () => {
        const s = await register(slug);
        const res = await as(s).post('/api/gifting/batches', { type: 'cash', amount_kobo: 100_00, filter: {} });
        expect(res.status).toBe(403);
    });

    it('refuses a batch with no recipients', async () => {
        const t = await member(slug, { role: 'treasurer' });
        const res = await as(t).post('/api/gifting/batches', { type: 'cash', amount_kobo: 100_00, filter: { lga_id: 99999 } });
        expect(res.status).toBe(400);
    });

    it('runs a cash batch end to end with two-person approval', async () => {
        const l = lga++;
        const r1 = await member(slug, { status: 'verified', lga_id: l });
        const r2 = await member(slug, { status: 'verified', lga_id: l });
        await member(slug, { status: 'pending', lga_id: l }); // not verified: excluded
        const creator = await member(slug, { role: 'treasurer' });
        const approver = await member(slug, { role: 'treasurer' });

        const created = await as(creator).post('/api/gifting/batches', { type: 'cash', amount_kobo: 500_00, filter: { lga_id: l } });
        expect(created.status).toBe(201);
        expect(created.body.batch).toMatchObject({ status: 'pending_approval', recipient_count: 2, total_amount_kobo: 1000_00 });
        const id = created.body.batch.id;

        const list = await as(approver).get('/api/gifting/batches?status=pending_approval');
        expect(list.body.batches.map((b: { id: string }) => b.id)).toContain(id);

        expect((await as(creator).post(`/api/gifting/batches/${id}/approve`)).status).toBe(403);
        expect((await as(approver).post(`/api/gifting/batches/${id}/approve`)).status).toBe(200);
        expect((await as(approver).post(`/api/gifting/batches/${id}/approve`)).status).toBe(400);

        for (const r of [r1, r2]) {
            const w = await as(r).get('/api/gifting/wallet');
            expect(w.body.wallet.balance_kobo).toBe(500_00);
            expect(w.body.wallet.transactions).toHaveLength(1);
            const g = await as(r).get('/api/gifting/me');
            expect(g.body.gifts[0]).toMatchObject({ type: 'cash', status: 'success', amount_kobo: 500_00 });
        }
        const batch = await prisma.giftBatch.findUniqueOrThrow({ where: { id } });
        expect(batch.status).toBe('completed');
    });

    it('accumulates wallet balances across batches', async () => {
        const l = lga++;
        const r = await member(slug, { status: 'verified', lga_id: l });
        const [a, b] = [await member(slug, { role: 'treasurer' }), await member(slug, { role: 'treasurer' })];
        for (const amount of [100_00, 250_00]) {
            const { body } = await as(a).post('/api/gifting/batches', { type: 'cash', amount_kobo: amount, filter: { lga_id: l } });
            expect((await as(b).post(`/api/gifting/batches/${body.batch.id}/approve`)).status).toBe(200);
        }
        const w = await as(r).get('/api/gifting/wallet');
        expect(w.body.wallet.balance_kobo).toBe(350_00);
        expect(w.body.wallet.transactions.map((t: { balance_after: number }) => t.balance_after).sort()).toEqual([100_00, 350_00]);
    });

    it('leaves airtime gifts pending and does not touch wallets', async () => {
        const l = lga++;
        const r = await member(slug, { status: 'verified', lga_id: l });
        const [a, b] = [await member(slug, { role: 'treasurer' }), await member(slug, { role: 'treasurer' })];
        const { body } = await as(a).post('/api/gifting/batches', { type: 'airtime', amount_kobo: 200_00, filter: { lga_id: l } });
        await as(b).post(`/api/gifting/batches/${body.batch.id}/approve`);
        expect((await as(r).get('/api/gifting/wallet')).body.wallet.balance_kobo).toBe(0);
        expect((await as(r).get('/api/gifting/me')).body.gifts[0].status).toBe('pending');
        expect((await prisma.giftBatch.findUniqueOrThrow({ where: { id: body.batch.id } })).status).toBe('processing');
    });

    it('refuses approval when the recipient list drifted', async () => {
        const l = lga++;
        await member(slug, { status: 'verified', lga_id: l });
        const [a, b] = [await member(slug, { role: 'treasurer' }), await member(slug, { role: 'treasurer' })];
        const { body } = await as(a).post('/api/gifting/batches', { type: 'cash', amount_kobo: 100_00, filter: { lga_id: l } });
        await member(slug, { status: 'verified', lga_id: l });
        expect((await as(b).post(`/api/gifting/batches/${body.batch.id}/approve`)).status).toBe(409);
    });

    it('filters recipients by level', async () => {
        const l = lga++;
        const leader = await member(slug, { status: 'verified', lga_id: l });
        await member(slug, { status: 'verified', lga_id: l });
        await prisma.tenantMember.update({ where: { id: leader.memberId }, data: { level_id: wardLeaderLevel } });
        const t = await member(slug, { role: 'treasurer' });
        const res = await as(t).post('/api/gifting/batches', { type: 'data', amount_kobo: 100_00, filter: { lga_id: l, level_id: wardLeaderLevel } });
        expect(res.body.batch.recipient_count).toBe(1);
    });

    it('rejects a pending batch', async () => {
        const l = lga++;
        await member(slug, { status: 'verified', lga_id: l });
        const [a, b] = [await member(slug, { role: 'treasurer' }), await member(slug, { role: 'treasurer' })];
        const { body } = await as(a).post('/api/gifting/batches', { type: 'cash', amount_kobo: 100_00, filter: { lga_id: l } });
        expect((await as(b).post(`/api/gifting/batches/${body.batch.id}/reject`)).status).toBe(200);
        expect((await as(b).post(`/api/gifting/batches/${body.batch.id}/approve`)).status).toBe(400);
    });

    it('cannot approve another tenant\'s batch', async () => {
        const other = (await createTenant()).slug;
        await member(other, { status: 'verified', lga_id: 1 });
        const a = await member(other, { role: 'treasurer' });
        const { body } = await as(a).post('/api/gifting/batches', { type: 'cash', amount_kobo: 100_00, filter: {} });
        const b = await member(slug, { role: 'treasurer' });
        expect((await as(b).post(`/api/gifting/batches/${body.batch.id}/approve`)).status).toBe(404);
    });
});

describe('gifting feature flag', () => {
    it('is blocked when the tenant disables gifting', async () => {
        const slug = (await createTenant({ disabled: ['gifting'] })).slug;
        const s = await register(slug);
        expect((await as(s).get('/api/gifting/wallet')).status).toBe(403);
    });
});
