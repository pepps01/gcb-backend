import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, createTenant, member, newNin, place, prisma, register, Session } from './helpers';

let slug: string;
let admin: Session;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%fake\n');

const upload = (s: Session, kind: string, body: Buffer, type = 'application/octet-stream') =>
    request(app).post(`/api/uploads?kind=${kind}`).set('X-Tenant-Slug', s.slug).set('Authorization', `Bearer ${s.token}`)
        .set('Content-Type', type).send(body);

beforeAll(async () => {
    slug = (await createTenant()).slug;
    admin = await member(slug, { role: 'tenant_admin' });
});

describe('locations', () => {
    const rows = [
        { lga: 'Okene', ward: 'Bariki', polling_unit: 'Bariki Pry Sch I', pu_code: '001' },
        { lga: 'Okene', ward: 'Bariki', polling_unit: 'Bariki Pry Sch II', pu_code: '002' },
        { lga: 'Okene', ward: 'Obehira', polling_unit: 'Obehira Market' },
        { lga: 'Adavi', ward: 'Ogaminana', polling_unit: 'Ogaminana Town Hall' },
    ];

    it('imports a constituency idempotently, admins only', async () => {
        const t = (await createTenant()).slug;
        const a = await member(t, { role: 'tenant_admin' });
        const s = await register(t);
        expect((await as(s).post('/api/locations/import', { rows })).status).toBe(403);

        const first = await as(a).post('/api/locations/import', { rows });
        expect(first.body.created).toEqual({ lgas: 2, wards: 3, polling_units: 4 });
        const again = await as(a).post('/api/locations/import', { rows: [...rows, { lga: 'okene', ward: 'BARIKI', polling_unit: 'New PU' }] });
        expect(again.body.created).toEqual({ lgas: 0, wards: 0, polling_units: 1 });

        const lgas = (await as(s).get('/api/locations/lgas')).body.lgas;
        expect(lgas.map((l: { name: string }) => l.name)).toEqual(['Adavi', 'Okene']);
        const okene = lgas.find((l: { name: string }) => l.name === 'Okene');
        const wards = (await as(s).get(`/api/locations/lgas/${okene.id}/wards`)).body.wards;
        const bariki = wards.find((w: { name: string }) => w.name === 'Bariki');
        const pus = (await as(s).get(`/api/locations/wards/${bariki.id}/polling-units`)).body.polling_units;
        expect(pus.map((p: { name: string }) => p.name)).toEqual(['Bariki Pry Sch I', 'Bariki Pry Sch II', 'New PU']);
    });

    it('keeps each tenant\'s locations separate', async () => {
        const other = (await createTenant()).slug;
        const { lga_id } = await place(other, 'Secret LGA');
        const s = await register(slug);
        expect((await as(s).get(`/api/locations/lgas/${lga_id}/wards`)).body.wards).toEqual([]);
        expect((await as(s).get('/api/locations/lgas')).body.lgas.map((l: { name: string }) => l.name)).not.toContain('Secret LGA');
    });
});

describe('step 1: personal details', () => {
    it('saves name and a consistent location, shown by name on /auth/me', async () => {
        const s = await register(slug);
        const loc = await place(slug, 'Okene', 'Bariki', 'PU 001');
        const elsewhere = await place(slug, 'Adavi', 'Kuroko', 'PU 009');

        const mixed = await as(s).patch('/api/members/me', { ...loc, ward_id: elsewhere.ward_id });
        expect(mixed.status).toBe(400);
        expect((await as(s).patch('/api/members/me', { lga_id: loc.lga_id })).status).toBe(400); // all three together

        expect((await as(s).patch('/api/members/me', { full_name: 'Amina Ibrahim', ...loc })).status).toBe(200);
        const me = (await as(s).get('/api/auth/me')).body;
        expect(me.user.full_name).toBe('Amina Ibrahim');
        expect(me.membership).toMatchObject({ ...loc, lga_name: 'Okene', ward_name: 'Bariki', polling_unit_name: 'PU 001', has_bank: false });
    });

    it('rejects a location from another tenant', async () => {
        const s = await register(slug);
        const foreign = await place((await createTenant()).slug);
        expect((await as(s).patch('/api/members/me', foreign)).status).toBe(400);
    });

    it('attaches a referrer once, by code, never yourself', async () => {
        const referrer = await register(slug);
        const code = (await as(referrer).get('/api/auth/me')).body.membership.referral_code;
        const s = await register(slug);
        const ownCode = (await as(s).get('/api/auth/me')).body.membership.referral_code;

        expect((await as(s).patch('/api/members/me', { referral_code: 'NOPE123' })).status).toBe(400);
        expect((await as(s).patch('/api/members/me', { referral_code: ownCode })).status).toBe(400);
        expect((await as(s).patch('/api/members/me', { referral_code: code.toLowerCase() })).status).toBe(200);
        expect((await as(s).patch('/api/members/me', { referral_code: code })).status).toBe(409);
        const refs = (await as(referrer).get('/api/members/me/referrals')).body.referrals;
        expect(refs.map((r: { id: string }) => r.id)).toContain(s.memberId);
    });
});

describe('step 2: voter identification', () => {
    it('accepts PNG/JPG/PDF only, checked by content not by Content-Type', async () => {
        const s = await register(slug);
        const png = await upload(s, 'kyc_nin_slip', PNG, 'image/png');
        expect(png.status).toBe(201);
        expect(png.body.upload).toMatchObject({ kind: 'kyc_nin_slip', mime: 'image/png' });
        expect((await upload(s, 'kyc_pvc', PDF)).body.upload.mime).toBe('application/pdf');
        expect((await upload(s, 'kyc_pvc', Buffer.from('<html>hi</html>'), 'image/png')).status).toBe(415);
        expect((await upload(s, 'selfie', PNG)).status).toBe(400);
        expect((await upload(s, 'kyc_pvc', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))).status).toBe(413);
    });

    it('shows a file only to its owner and KYC reviewers', async () => {
        const s = await register(slug);
        const { id } = (await upload(s, 'kyc_pvc', PNG)).body.upload;
        const own = await as(s).get(`/api/uploads/${id}`);
        expect(own.status).toBe(200);
        expect(own.headers['content-type']).toBe('image/png');
        expect(own.headers['cache-control']).toContain('no-store');
        expect((await as(await register(slug)).get(`/api/uploads/${id}`)).status).toBe(404);
        expect((await as(await member(slug, { role: 'treasurer' })).get(`/api/uploads/${id}`)).status).toBe(404);
        expect((await as(await member(slug, { role: 'lga_coordinator' })).get(`/api/uploads/${id}`)).status).toBe(200);
    });

    it('submits using the saved location and own uploads, then locks the location', async () => {
        const s = await register(slug);
        const loc = await place(slug, 'Okene', 'Bariki', 'PU 001');
        expect((await as(s).post('/api/kyc/submit', { nin: newNin(), vin: '90F5B1234567890' })).status).toBe(400); // no location yet
        await as(s).patch('/api/members/me', loc);

        const slip = (await upload(s, 'kyc_nin_slip', PNG)).body.upload.id;
        const pvc = (await upload(s, 'kyc_pvc', PDF)).body.upload.id;
        const stranger = (await upload(await register(slug), 'kyc_pvc', PNG)).body.upload.id;
        const base = { nin: newNin(), vin: '90F5B1234567890' };
        expect((await as(s).post('/api/kyc/submit', { ...base, pvc_upload_id: stranger })).status).toBe(400);
        expect((await as(s).post('/api/kyc/submit', { ...base, nin_slip_upload_id: pvc })).status).toBe(400); // wrong kind
        expect((await as(s).post('/api/kyc/submit', { ...base, nin: '123' })).status).toBe(400);

        const ok = await as(s).post('/api/kyc/submit', { ...base, nin_slip_upload_id: slip, pvc_upload_id: pvc });
        expect(ok.status).toBe(201);
        expect((await as(s).patch('/api/members/me', await place(slug, 'Adavi', 'Kuroko', 'PU 009'))).status).toBe(409);
        expect((await as(s).patch('/api/members/me', { full_name: 'Still Editable' })).status).toBe(200);

        const list = (await as(admin).get('/api/kyc/submissions')).body.submissions;
        const sub = list.find((x: { member: { id: string } }) => x.member.id === s.memberId);
        expect(sub).toMatchObject({ nin_slip_upload_id: slip, pvc_upload_id: pvc, lga_name: 'Okene', ward_name: 'Bariki', polling_unit_name: 'PU 001' });
    });
});

describe('step 3: bank details', () => {
    it('validates, saves and updates the member\'s account', async () => {
        const s = await register(slug);
        expect((await as(s).get('/api/members/me/bank')).body.bank).toBeNull();
        expect((await as(s).put('/api/members/me/bank', { bank_name: 'GTBank', account_number: '12345', account_name: 'Amina Ibrahim' })).status).toBe(400);
        const saved = await as(s).put('/api/members/me/bank', { bank_name: 'GTBank', account_number: '0123456789', account_name: 'Amina Ibrahim' });
        expect(saved.status).toBe(200);
        await as(s).put('/api/members/me/bank', { bank_name: 'Access Bank', account_number: '0123456789', account_name: 'Amina Ibrahim' });
        expect((await as(s).get('/api/members/me/bank')).body.bank).toMatchObject({ bank_name: 'Access Bank', account_number: '0123456789' });
        expect((await as(s).get('/api/auth/me')).body.membership.has_bank).toBe(true);
    });

    it('lets treasurers read payout details, audited; not supporters or other tenants', async () => {
        const s = await register(slug);
        await as(s).put('/api/members/me/bank', { bank_name: 'Zenith Bank', account_number: '1111111111', account_name: 'Test' });
        const t = await member(slug, { role: 'treasurer' });
        expect((await as(t).get(`/api/members/${s.memberId}/bank`)).body.bank.account_number).toBe('1111111111');
        expect(await prisma.auditLog.count({ where: { action: 'member.bank.view', entity_id: s.memberId } })).toBe(1);
        expect((await as(await register(slug)).get(`/api/members/${s.memberId}/bank`)).status).toBe(403);
        const foreign = await member((await createTenant()).slug, { role: 'treasurer' });
        expect((await as(foreign).get(`/api/members/${s.memberId}/bank`)).body.bank).toBeNull();
    });
});
