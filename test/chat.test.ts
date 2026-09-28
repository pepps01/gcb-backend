import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { app, as, createTenant, member, newNin, place, prisma, register, Session } from './helpers';
import { attachRealtime } from '../src/realtime/io';

let slug: string;
let admin: Session;

beforeAll(async () => {
    slug = (await createTenant()).slug;
    admin = await member(slug, { role: 'tenant_admin' });
});

/** Registers a member and verifies them through KYC so auto-membership runs. */
async function verified(tenantSlug: string, lga: string, ward: string, reviewer = admin) {
    const s = await register(tenantSlug);
    const loc = await place(tenantSlug, lga, ward);
    const r0 = await as(s).post('/api/kyc/submit', { nin: newNin(), vin: '90F5B1234567890', ...loc });
    if (r0.status !== 201) throw new Error(`submit failed ${r0.status} ${JSON.stringify(r0.body)}`);
    const { body } = await as(reviewer).get('/api/kyc/submissions');
    const sub = body.submissions.find((x: { member: { id: string } }) => x.member.id === s.memberId);
    const r = await as(reviewer).post('/api/kyc/review', { submission_id: sub.id, decision: 'verified' });
    if (r.status !== 200) throw new Error(`review failed ${r.status}`);
    return s;
}

const conversations = async (s: Session) => (await as(s).get('/api/chat/conversations')).body.conversations as {
    id: string; type: string; name: string; unread: number; member_count: number; scope_type: string | null; last_message: { body: string } | null;
}[];

const send = (s: Session, id: string, body: string, extra: object = {}) =>
    as(s).post(`/api/chat/conversations/${id}/messages`, { body, ...extra });

async function direct(a: Session, b: Session) {
    const res = await as(a).post('/api/chat/conversations/direct', { member_id: b.memberId });
    return res.body.conversation.id as string;
}

describe('direct messages', () => {
    it('creates one conversation per pair, with unread counts and read markers', async () => {
        const a = await register(slug, { full_name: 'Amina Direct' });
        const b = await register(slug, { full_name: 'Bayo Direct' });
        const first = await as(a).post('/api/chat/conversations/direct', { member_id: b.memberId });
        expect(first.status).toBe(201);
        const again = await as(b).post('/api/chat/conversations/direct', { member_id: a.memberId });
        expect(again.status).toBe(200);
        expect(again.body.conversation.id).toBe(first.body.conversation.id);
        const id = first.body.conversation.id;

        const m1 = await send(a, id, 'Hello');
        expect(m1.status).toBe(201);
        await send(a, id, 'Are you there?');

        const bList = await conversations(b);
        const c = bList.find((x) => x.id === id)!;
        expect(c).toMatchObject({ type: 'direct', name: 'Amina Direct', unread: 2, last_message: { body: 'Are you there?' } });
        expect((await conversations(a)).find((x) => x.id === id)!.unread).toBe(0); // own messages don't count

        const history = await as(b).get(`/api/chat/conversations/${id}/messages`);
        const lastId = history.body.messages.at(-1).id;
        await as(b).post(`/api/chat/conversations/${id}/read`, { message_id: lastId });
        expect((await conversations(b)).find((x) => x.id === id)!.unread).toBe(0);
        // The marker never moves backwards
        await as(b).post(`/api/chat/conversations/${id}/read`, { message_id: m1.body.message.id });
        expect((await conversations(b)).find((x) => x.id === id)!.unread).toBe(0);
    });

    it('hides the conversation from non-members and other tenants', async () => {
        const [a, b, c] = [await register(slug), await register(slug), await register(slug)];
        const id = await direct(a, b);
        expect((await as(c).get(`/api/chat/conversations/${id}/messages`)).status).toBe(404);
        expect((await send(c, id, 'sneaky')).status).toBe(404);
        expect((await as(admin).get(`/api/chat/conversations/${id}/messages`)).status).toBe(404);

        const other = (await createTenant()).slug;
        const foreign = await member(other, { role: 'tenant_admin' });
        expect((await as(foreign).get(`/api/chat/conversations/${id}`)).status).toBe(404);
        expect((await as(foreign).post('/api/chat/conversations/direct', { member_id: a.memberId })).status).toBe(400);
    });

    it('refuses messaging yourself', async () => {
        const a = await register(slug);
        expect((await as(a).post('/api/chat/conversations/direct', { member_id: a.memberId })).status).toBe(400);
    });

    it('paginates history oldest-first within a page', async () => {
        const [a, b] = [await register(slug), await register(slug)];
        const id = await direct(a, b);
        for (let i = 1; i <= 5; i++) await send(a, id, `m${i}`);
        const page1 = await as(b).get(`/api/chat/conversations/${id}/messages?limit=2`);
        expect(page1.body.messages.map((m: { body: string }) => m.body)).toEqual(['m4', 'm5']);
        expect(page1.body.has_more).toBe(true);
        const page2 = await as(b).get(`/api/chat/conversations/${id}/messages?limit=2&before=${page1.body.messages[0].id}`);
        expect(page2.body.messages.map((m: { body: string }) => m.body)).toEqual(['m2', 'm3']);
    });

    it('stores a retried send once (client_id)', async () => {
        const [a, b] = [await register(slug), await register(slug)];
        const id = await direct(a, b);
        const r1 = await send(a, id, 'once', { client_id: 'abc-1' });
        const r2 = await send(a, id, 'once', { client_id: 'abc-1' });
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(200);
        expect(r2.body.message.id).toBe(r1.body.message.id);
        expect((await as(b).get(`/api/chat/conversations/${id}/messages`)).body.messages).toHaveLength(1);
    });

    it('validates replies and message bodies', async () => {
        const [a, b] = [await register(slug), await register(slug)];
        const id = await direct(a, b);
        const other = await direct(a, await register(slug));
        const { body } = await send(a, other, 'elsewhere');
        expect((await send(a, id, 'reply', { reply_to_id: body.message.id })).status).toBe(400);
        expect((await send(a, id, '   ')).status).toBe(400);
        expect((await send(a, id, 'x'.repeat(4001))).status).toBe(400);
        const parent = await send(b, id, 'question');
        const reply = await send(a, id, 'answer', { reply_to_id: parent.body.message.id });
        expect(reply.body.message.reply_to_id).toBe(parent.body.message.id);
    });

    it('lists people by name without phone numbers', async () => {
        const a = await register(slug, { full_name: 'Chidi Findable' });
        const b = await register(slug);
        const res = await as(b).get('/api/chat/people?q=Findable');
        expect(res.body.people).toEqual([expect.objectContaining({ member_id: a.memberId, name: 'Chidi Findable' })]);
        expect(JSON.stringify(res.body)).not.toContain(a.phone);
    });
});

describe('automatic ward and LGA groups', () => {
    it('adds verified members to their ward and LGA groups', async () => {
        const a = await verified(slug, 'Adavi', 'Ogaminana');
        const b = await verified(slug, 'Adavi', 'Kuroko');
        const aGroups = (await conversations(a)).filter((c) => c.scope_type);
        expect(aGroups.map((c) => c.name).sort()).toEqual(['Adavi LGA', 'Ogaminana Ward']);
        const lga = (await conversations(b)).find((c) => c.name === 'Adavi LGA')!;
        expect(lga.member_count).toBe(2);
        expect(lga.id).toBe(aGroups.find((c) => c.name === 'Adavi LGA')!.id);

        // Members can talk in it, but can't leave it
        expect((await send(a, lga.id, 'Hello Adavi')).status).toBe(201);
        expect((await as(a).delete(`/api/chat/conversations/${lga.id}/members/${a.memberId}`)).status).toBe(400);
    });

    it('does not add unverified members', async () => {
        const s = await register(slug);
        await as(s).post('/api/kyc/submit', { nin: newNin(), vin: '90F5B1234567890', ...(await place(slug, 'Ajaokuta', 'Adogo')) });
        expect(await conversations(s)).toEqual([]);
    });

    it('removes banned members from scoped groups', async () => {
        const s = await verified(slug, 'Okehi', 'Eika');
        const lga = (await conversations(s)).find((c) => c.name === 'Okehi LGA')!;
        await as(admin).patch(`/api/members/${s.memberId}`, { status: 'banned' });
        const rows = await prisma.conversationMember.findMany({ where: { member_id: s.memberId } });
        expect(rows.map((r) => r.conversation_id)).not.toContain(lga.id);
        expect(rows).toEqual([]);
    });

    it('is off when group chat is disabled', async () => {
        const off = (await createTenant({ disabled: ['group_chat'] })).slug;
        const offAdmin = await member(off, { role: 'tenant_admin' });
        const s = await verified(off, 'Okene', 'Bariki', offAdmin);
        expect(await conversations(s)).toEqual([]);
        expect((await as(offAdmin).post('/api/chat/conversations', { type: 'group', name: 'Nope' })).status).toBe(403);
    });
});

describe('broadcast channels', () => {
    it('reaches everyone in scope, including members verified later, and only moderators post', async () => {
        const early = await verified(slug, 'Ogori/Magongo', 'Eni');
        const elsewhere = await verified(slug, 'Okene', 'Obehira');
        const coord = await member(slug, { role: 'lga_coordinator' });
        const { lga_id } = await place(slug, 'Ogori/Magongo', 'Eni');

        const created = await as(coord).post('/api/chat/conversations', { type: 'broadcast', name: 'Ogori updates', scope_type: 'lga', scope_id: lga_id });
        expect(created.status).toBe(201);
        const id = created.body.conversation.id;
        expect(created.body.conversation.member_count).toBe(2); // coordinator + early

        const late = await verified(slug, 'Ogori/Magongo', 'Okibo');
        expect((await conversations(late)).map((c) => c.id)).toContain(id);
        expect((await conversations(elsewhere)).map((c) => c.id)).not.toContain(id);

        expect((await send(early, id, 'can I post?')).status).toBe(403);
        expect((await send(coord, id, 'Rally at 10am')).status).toBe(201);
        expect((await conversations(late)).find((c) => c.id === id)!.unread).toBe(1);
        const info = await as(early).get(`/api/chat/conversations/${id}`);
        expect(info.body.conversation).toMatchObject({ can_post: false, can_moderate: false });
    });

    it('requires lga_id for an LGA scope, and staff to create', async () => {
        const coord = await member(slug, { role: 'lga_coordinator' });
        expect((await as(coord).post('/api/chat/conversations', { type: 'broadcast', name: 'Bad', scope_type: 'lga' })).status).toBe(400);
        const s = await register(slug);
        expect((await as(s).post('/api/chat/conversations', { type: 'group', name: 'Mine' })).status).toBe(403);
    });
});

describe('moderation', () => {
    async function group() {
        const coord = await member(slug, { role: 'lga_coordinator' });
        const [a, b] = [await register(slug), await register(slug)];
        const { body } = await as(coord).post('/api/chat/conversations', { type: 'group', name: 'Volunteers', member_ids: [a.memberId, b.memberId] });
        return { coord, a, b, id: body.conversation.id as string };
    }

    it('mutes and unmutes a member', async () => {
        const { coord, a, id } = await group();
        const until = new Date(Date.now() + 3600_000).toISOString();
        expect((await as(coord).patch(`/api/chat/conversations/${id}/members/${a.memberId}`, { muted_until: until })).status).toBe(200);
        expect((await send(a, id, 'hi')).status).toBe(403);
        await as(coord).patch(`/api/chat/conversations/${id}/members/${a.memberId}`, { muted_until: null });
        expect((await send(a, id, 'hi')).status).toBe(201);
    });

    it('lets moderators delete any message and members only their own', async () => {
        const { coord, a, b, id } = await group();
        const msg = (await send(a, id, 'something bad')).body.message;
        expect((await as(b).delete(`/api/chat/messages/${msg.id}`)).status).toBe(403);
        expect((await as(coord).delete(`/api/chat/messages/${msg.id}`)).status).toBe(204);
        const hist = await as(b).get(`/api/chat/conversations/${id}/messages`);
        expect(hist.body.messages[0]).toMatchObject({ id: msg.id, body: null, deleted: true });

        const own = (await send(b, id, 'oops')).body.message;
        expect((await as(b).delete(`/api/chat/messages/${own.id}`)).status).toBe(204);
    });

    it('adds, promotes and removes members; members cannot', async () => {
        const { coord, a, b, id } = await group();
        const c = await register(slug);
        expect((await as(a).post(`/api/chat/conversations/${id}/members`, { member_ids: [c.memberId] })).status).toBe(403);
        expect((await as(coord).post(`/api/chat/conversations/${id}/members`, { member_ids: [c.memberId] })).body.added).toBe(1);

        await as(coord).patch(`/api/chat/conversations/${id}/members/${a.memberId}`, { role: 'moderator' });
        expect((await as(a).delete(`/api/chat/conversations/${id}/members/${b.memberId}`)).status).toBe(204);
        expect((await as(b).get(`/api/chat/conversations/${id}/messages`)).status).toBe(404);

        // Anyone may leave a manual group
        expect((await as(c).delete(`/api/chat/conversations/${id}/members/${c.memberId}`)).status).toBe(204);
    });

    it('gives tenant admins moderation without membership, but only in their own tenant', async () => {
        const { a, id } = await group();
        expect((await as(admin).patch(`/api/chat/conversations/${id}`, { name: 'Renamed' })).status).toBe(200);

        const foreign = await member((await createTenant()).slug, { role: 'tenant_admin' });
        expect((await as(foreign).patch(`/api/chat/conversations/${id}`, { name: 'Hijacked' })).status).toBe(404);
        expect((await as(foreign).delete(`/api/chat/conversations/${id}/members/${a.memberId}`)).status).toBe(404);
        const msg = (await send(a, id, 'hello')).body.message;
        expect((await as(foreign).delete(`/api/chat/messages/${msg.id}`)).status).toBe(404);
    });

    it('queues reports for staff, who can resolve and delete', async () => {
        const { a, b, id } = await group();
        const msg = (await send(a, id, 'spam spam')).body.message;
        expect((await as(a).post(`/api/chat/messages/${msg.id}/report`, { reason: 'my own' })).status).toBe(400);
        expect((await as(b).post(`/api/chat/messages/${msg.id}/report`, { reason: 'Spam' })).status).toBe(201);
        expect((await as(b).post(`/api/chat/messages/${msg.id}/report`, { reason: 'Spam' })).status).toBe(409);
        expect((await as(b).get('/api/chat/reports')).status).toBe(403);

        const list = await as(admin).get('/api/chat/reports');
        const report = list.body.reports.find((r: { message: { id: number } }) => r.message.id === msg.id);
        expect(report).toMatchObject({ reason: 'Spam', message: { body: 'spam spam' } });

        expect((await as(admin).patch(`/api/chat/reports/${report.id}`, { status: 'actioned', delete_message: true })).status).toBe(200);
        const hist = await as(b).get(`/api/chat/conversations/${id}/messages`);
        expect(hist.body.messages.find((m: { id: number }) => m.id === msg.id).deleted).toBe(true);
    });
});

describe('realtime', () => {
    let server: http.Server;
    let url: string;
    const sockets: Socket[] = [];

    beforeAll(async () => {
        server = http.createServer(app);
        attachRealtime(server);
        await new Promise<void>((r) => server.listen(0, r));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        sockets.forEach((s) => s.disconnect());
        await new Promise((r) => server.close(r));
    });

    function open(s: Pick<Session, 'token' | 'slug'>) {
        const socket = connect(url, { auth: { token: s.token, tenant: s.slug }, transports: ['websocket'], reconnection: false });
        sockets.push(socket);
        return socket;
    }
    const ready = (socket: Socket) =>
        new Promise<void>((resolve, reject) => {
            socket.once('ready', () => resolve());
            socket.once('connect_error', reject);
        });
    const next = <T>(socket: Socket, event: string) => new Promise<T>((resolve) => socket.once(event, resolve));

    it('rejects bad tokens and tokens for another tenant', async () => {
        const bad = open({ token: 'nope', slug });
        await expect(ready(bad)).rejects.toThrow(/unauthorized/);
        const s = await register(slug);
        const other = (await createTenant()).slug;
        await expect(ready(open({ token: s.token, slug: other }))).rejects.toThrow(/unauthorized/);
    });

    it('delivers new messages, joins and deletions live', async () => {
        const [a, b] = [await register(slug), await register(slug)];
        const sb = open(b);
        await ready(sb);

        const joined = next<{ conversation_id: string }>(sb, 'conversation:joined');
        const id = await direct(a, b);
        expect((await joined).conversation_id).toBe(id);

        const incoming = next<{ body: string; sender: { member_id: string } }>(sb, 'message:new');
        const sent = await send(a, id, 'live hello');
        expect(await incoming).toMatchObject({ body: 'live hello', sender: { member_id: a.memberId } });

        const deleted = next<{ id: number }>(sb, 'message:deleted');
        await as(a).delete(`/api/chat/messages/${sent.body.message.id}`);
        expect((await deleted).id).toBe(sent.body.message.id);
    });

    it('relays typing only within the conversation', async () => {
        const [a, b, c] = [await register(slug, { full_name: 'Typer' }), await register(slug), await register(slug)];
        const id = await direct(a, b);
        const [sa, sb, sc] = [open(a), open(b), open(c)];
        await Promise.all([ready(sa), ready(sb), ready(sc)]);
        let leaked = false;
        sc.on('typing', () => { leaked = true; });
        const typing = next<{ name: string }>(sb, 'typing');
        sa.emit('typing', { conversation_id: id });
        sc.emit('typing', { conversation_id: id }); // not a member: ignored
        expect((await typing).name).toBe('Typer');
        await new Promise((r) => setTimeout(r, 200));
        expect(leaked).toBe(false);
    });

    it('disconnects a member when they are banned', async () => {
        const s = await register(slug);
        const socket = open(s);
        await ready(socket);
        const gone = next(socket, 'disconnect');
        await as(admin).patch(`/api/members/${s.memberId}`, { status: 'banned' });
        await gone;
        await expect(ready(open(s))).rejects.toThrow(/unauthorized/);
    });
});
