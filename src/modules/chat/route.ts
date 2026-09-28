import { Request, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth, requireRole } from '../../middleware/auth';
import { messageLimiter } from '../../middleware/rateLimit';
import { emitToConversation, emitToMember, joinConversation, leaveConversation } from '../../realtime/io';
import { membersInScope } from './membership';

const router = Router();
router.use(requireAuth);

// Which tenant feature each conversation type needs
const FEATURE_FOR: Record<string, string> = { direct: 'messaging', group: 'group_chat', broadcast: 'broadcast' };
const featureOn = (req: Request, key: string) => !!req.tenant!.features[key]?.enabled;
const isAdmin = (req: Request) => req.membership!.role === 'tenant_admin';
const STAFF = ['tenant_admin', 'lga_coordinator'] as const;

const idParam = (v: unknown) => {
    const s = String(v);
    if (!/^\d{1,19}$/.test(s)) throw { status: 400, message: 'Invalid message id' };
    return BigInt(s);
};

/**
 * Loads a conversation the caller belongs to. Non-members get 404 (not 403) so conversation ids
 * don't leak; `allowAdmin` lets tenant admins through for moderation without joining.
 */
async function access(req: Request, conversationId: string, opts: { allowAdmin?: boolean } = {}) {
    const tenant_id = req.tenant!.id;
    const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenant_id } });
    const cm = conv
        ? await prisma.conversationMember.findUnique({
            where: { conversation_id_member_id: { conversation_id: conv.id, member_id: req.membership!.id } },
        })
        : null;
    if (!conv || (!cm && !(opts.allowAdmin && isAdmin(req)))) throw { status: 404, message: 'Conversation not found' };
    if (!featureOn(req, FEATURE_FOR[conv.type])) throw { status: 403, message: `Feature '${FEATURE_FOR[conv.type]}' disabled for this tenant` };
    return { conv, cm };
}

const canModerate = (req: Request, cm: { role: string } | null) => isAdmin(req) || cm?.role === 'moderator';

function requireModerator(req: Request, cm: { role: string } | null) {
    if (!canModerate(req, cm)) throw { status: 403, message: 'Only moderators can do this' };
}

/** Members of this tenant (not banned) among `ids`; throws if any are unknown. */
async function validMembers(tenant_id: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await prisma.tenantMember.findMany({
        where: { tenant_id, id: { in: unique }, status: { not: 'banned' } },
        select: { id: true },
    });
    if (found.length !== unique.length) throw { status: 400, message: 'Unknown member in list' };
    return unique;
}

const messageSelect = {
    id: true, conversation_id: true, body: true, reply_to_id: true, client_id: true, deleted_at: true, created_at: true,
    sender: { select: { id: true, user: { select: { full_name: true } } } },
} as const;

type MessageRow = {
    id: bigint; conversation_id: string; body: string; reply_to_id: bigint | null; client_id: string | null;
    deleted_at: Date | null; created_at: Date; sender: { id: string; user: { full_name: string | null } };
};

const toMessage = (m: MessageRow) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender: { member_id: m.sender.id, name: m.sender.user.full_name },
    body: m.deleted_at ? null : m.body,
    deleted: !!m.deleted_at,
    reply_to_id: m.reply_to_id,
    client_id: m.client_id,
    created_at: m.created_at,
});

async function audit(req: Request, action: string, entity_type: string, entity_id: string, after_data?: object) {
    await prisma.auditLog.create({
        data: { tenant_id: req.tenant!.id, actor_user_id: req.user!.id, action, entity_type, entity_id, after_data },
    });
}

// ---------- conversations ----------

router.get(
    '/conversations',
    asyncHandler(async (req, res) => {
        const tenant_id = req.tenant!.id;
        const member_id = req.membership!.id;
        const rows = await prisma.conversationMember.findMany({
            where: { tenant_id, member_id },
            select: {
                role: true, muted_until: true, last_read_message_id: true,
                conversation: {
                    select: {
                        id: true, type: true, name: true, description: true, scope_type: true, scope_id: true,
                        last_message_id: true, last_message_at: true, created_at: true,
                        _count: { select: { members: true } },
                    },
                },
            },
        });
        const visible = rows.filter((r) => featureOn(req, FEATURE_FOR[r.conversation.type]));
        const ids = visible.map((r) => r.conversation.id);

        const [unreadRows, lastMessages, directPeers] = ids.length
            ? await Promise.all([
                prisma.$queryRaw<{ conversation_id: string; unread: bigint }[]>`
                    SELECT cm.conversation_id, COUNT(m.id) AS unread
                    FROM conversation_members cm
                    JOIN messages m ON m.conversation_id = cm.conversation_id
                        AND m.id > COALESCE(cm.last_read_message_id, 0)
                        AND m.deleted_at IS NULL
                        AND m.sender_member_id <> cm.member_id
                    WHERE cm.tenant_id = ${tenant_id} AND cm.member_id = ${member_id}
                    GROUP BY cm.conversation_id`,
                prisma.message.findMany({
                    where: { id: { in: visible.flatMap((r) => (r.conversation.last_message_id ? [r.conversation.last_message_id] : [])) } },
                    select: messageSelect,
                }),
                prisma.conversationMember.findMany({
                    where: {
                        tenant_id,
                        conversation_id: { in: visible.filter((r) => r.conversation.type === 'direct').map((r) => r.conversation.id) },
                        member_id: { not: member_id },
                    },
                    select: { conversation_id: true, member_id: true, member: { select: { user: { select: { full_name: true } } } } },
                }),
            ])
            : [[], [], []];

        const unread = new Map(unreadRows.map((u) => [u.conversation_id, Number(u.unread)]));
        const last = new Map(lastMessages.map((m) => [m.conversation_id, toMessage(m)]));
        const peer = new Map(directPeers.map((p) => [p.conversation_id, { member_id: p.member_id, name: p.member.user.full_name }]));

        const conversations = visible
            .map((r) => {
                const c = r.conversation;
                return {
                    id: c.id,
                    type: c.type,
                    name: c.type === 'direct' ? peer.get(c.id)?.name ?? 'Direct message' : c.name,
                    description: c.description,
                    scope_type: c.scope_type,
                    scope_id: c.scope_id,
                    peer: peer.get(c.id) ?? null,
                    member_count: c._count.members,
                    my_role: r.role,
                    muted_until: r.muted_until,
                    unread: unread.get(c.id) ?? 0,
                    last_message: last.get(c.id) ?? null,
                    last_activity: c.last_message_at ?? c.created_at,
                };
            })
            .sort((a, b) => +b.last_activity - +a.last_activity);

        res.json({ conversations });
    })
);

router.post(
    '/conversations/direct',
    asyncHandler(async (req, res) => {
        if (!featureOn(req, 'messaging')) throw { status: 403, message: "Feature 'messaging' disabled for this tenant" };
        const { member_id } = z.object({ member_id: z.string().uuid() }).parse(req.body);
        const tenant_id = req.tenant!.id;
        const me = req.membership!.id;
        if (member_id === me) throw { status: 400, message: 'You cannot message yourself' };
        await validMembers(tenant_id, [member_id]);

        const direct_key = [me, member_id].sort().join(':');
        let conv = await prisma.conversation.findUnique({ where: { tenant_id_direct_key: { tenant_id, direct_key } }, select: { id: true } });
        let created = false;
        if (!conv) {
            try {
                conv = await prisma.conversation.create({
                    data: {
                        tenant_id, type: 'direct', direct_key, created_by: req.user!.id,
                        members: { create: [{ member_id: me, tenant_id }, { member_id, tenant_id }] },
                    },
                    select: { id: true },
                });
                created = true;
            } catch (e: any) {
                if (e?.code !== 'P2002') throw e;
                conv = await prisma.conversation.findUniqueOrThrow({ where: { tenant_id_direct_key: { tenant_id, direct_key } }, select: { id: true } });
            }
        }
        if (created) joinConversation([me, member_id], conv.id);
        res.status(created ? 201 : 200).json({ conversation: conv });
    })
);

const createSchema = z
    .object({
        type: z.enum(['group', 'broadcast']),
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(255).optional(),
        scope_type: z.enum(['all', 'lga', 'ward']).optional(),
        scope_id: z.number().int().optional(),
        member_ids: z.array(z.string().uuid()).max(500).default([]),
    })
    .refine((b) => !b.scope_type || b.scope_type === 'all' || b.scope_id != null, {
        message: 'scope_id is required for lga/ward scope',
        path: ['scope_id'],
    });

router.post(
    '/conversations',
    requireRole(...STAFF),
    asyncHandler(async (req, res) => {
        const body = createSchema.parse(req.body);
        const feature = FEATURE_FOR[body.type];
        if (!featureOn(req, feature)) throw { status: 403, message: `Feature '${feature}' disabled for this tenant` };
        const tenant_id = req.tenant!.id;
        const me = req.membership!.id;

        const explicit = await validMembers(tenant_id, body.member_ids.filter((id) => id !== me));
        const scoped = body.scope_type ? await membersInScope(tenant_id, body.scope_type, body.scope_id) : [];
        const members = [...new Set([...explicit, ...scoped])].filter((id) => id !== me);

        const conv = await prisma.$transaction(async (tx) => {
            const c = await tx.conversation.create({
                data: {
                    tenant_id, type: body.type, name: body.name, description: body.description ?? null,
                    scope_type: body.scope_type ?? null,
                    scope_id: body.scope_type && body.scope_type !== 'all' ? body.scope_id : null,
                    created_by: req.user!.id,
                },
                select: { id: true, type: true, name: true },
            });
            await tx.conversationMember.createMany({
                data: [
                    { conversation_id: c.id, member_id: me, tenant_id, role: 'moderator' },
                    ...members.map((member_id) => ({ conversation_id: c.id, member_id, tenant_id })),
                ],
            });
            return c;
        });
        joinConversation([me, ...members], conv.id);
        await audit(req, 'chat.create', 'conversation', conv.id, { type: body.type, scope_type: body.scope_type, members: members.length + 1 });
        res.status(201).json({ conversation: { ...conv, member_count: members.length + 1 } });
    })
);

router.get(
    '/conversations/:id',
    asyncHandler(async (req, res) => {
        const { conv, cm } = await access(req, String(req.params.id));
        const members = await prisma.conversationMember.findMany({
            where: { conversation_id: conv.id },
            orderBy: [{ role: 'desc' }, { joined_at: 'asc' }],
            take: 500,
            select: {
                member_id: true, role: true, muted_until: true, joined_at: true,
                member: { select: { user: { select: { full_name: true } } } },
            },
        });
        const member_count = await prisma.conversationMember.count({ where: { conversation_id: conv.id } });
        res.json({
            conversation: {
                id: conv.id, type: conv.type, name: conv.name, description: conv.description,
                scope_type: conv.scope_type, scope_id: conv.scope_id, automatic: !!conv.auto_key,
                my_role: cm?.role ?? null, muted_until: cm?.muted_until ?? null,
                can_post: conv.type !== 'broadcast' || canModerate(req, cm),
                can_moderate: conv.type !== 'direct' && canModerate(req, cm),
                member_count,
            },
            members: members.map((m) => ({
                member_id: m.member_id, name: m.member.user.full_name, role: m.role, muted_until: m.muted_until, joined_at: m.joined_at,
            })),
        });
    })
);

router.patch(
    '/conversations/:id',
    asyncHandler(async (req, res) => {
        const body = z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(255).nullable().optional() }).parse(req.body);
        const { conv, cm } = await access(req, String(req.params.id), { allowAdmin: true });
        if (conv.type === 'direct') throw { status: 400, message: 'Direct messages have no settings' };
        requireModerator(req, cm);
        await prisma.conversation.update({ where: { id: conv.id }, data: body });
        emitToConversation(conv.id, 'conversation:updated', { conversation_id: conv.id, ...body });
        res.json({ ok: true });
    })
);

// ---------- messages ----------

router.get(
    '/conversations/:id/messages',
    asyncHandler(async (req, res) => {
        const q = z.object({ before: z.string().regex(/^\d+$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
        const { conv } = await access(req, String(req.params.id));
        const rows = await prisma.message.findMany({
            where: { conversation_id: conv.id, ...(q.before ? { id: { lt: BigInt(q.before) } } : {}) },
            orderBy: { id: 'desc' },
            take: q.limit,
            select: messageSelect,
        });
        res.json({ messages: rows.reverse().map(toMessage), has_more: rows.length === q.limit });
    })
);

const sendSchema = z.object({
    body: z.string().trim().min(1).max(4000),
    client_id: z.string().min(1).max(64).optional(),
    reply_to_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

router.post(
    '/conversations/:id/messages',
    messageLimiter,
    asyncHandler(async (req, res) => {
        const body = sendSchema.parse(req.body);
        const { conv, cm } = await access(req, String(req.params.id));
        const me = req.membership!.id;
        if (conv.type === 'broadcast' && !canModerate(req, cm)) throw { status: 403, message: 'Only moderators can post in a broadcast channel' };
        if (cm!.muted_until && cm!.muted_until > new Date()) throw { status: 403, message: 'You are muted in this conversation' };

        if (body.client_id) {
            const existing = await prisma.message.findUnique({
                where: { sender_member_id_client_id: { sender_member_id: me, client_id: body.client_id } },
                select: messageSelect,
            });
            if (existing) {
                if (existing.conversation_id !== conv.id) throw { status: 409, message: 'client_id already used' };
                return res.json({ message: toMessage(existing) });
            }
        }
        const reply_to_id = body.reply_to_id != null ? BigInt(body.reply_to_id) : null;
        if (reply_to_id) {
            const parent = await prisma.message.findFirst({ where: { id: reply_to_id, conversation_id: conv.id }, select: { id: true } });
            if (!parent) throw { status: 400, message: 'Reply target not found in this conversation' };
        }

        const msg = await prisma.$transaction(async (tx) => {
            const m = await tx.message.create({
                data: { tenant_id: req.tenant!.id, conversation_id: conv.id, sender_member_id: me, body: body.body, client_id: body.client_id ?? null, reply_to_id },
                select: messageSelect,
            });
            await tx.conversation.update({ where: { id: conv.id }, data: { last_message_id: m.id, last_message_at: m.created_at } });
            await tx.conversationMember.update({
                where: { conversation_id_member_id: { conversation_id: conv.id, member_id: me } },
                data: { last_read_message_id: m.id },
            });
            return m;
        });
        const out = toMessage(msg);
        emitToConversation(conv.id, 'message:new', out);
        res.status(201).json({ message: out });
    })
);

router.post(
    '/conversations/:id/read',
    asyncHandler(async (req, res) => {
        const { message_id } = z.object({ message_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]) }).parse(req.body);
        const { conv } = await access(req, String(req.params.id));
        const id = BigInt(message_id);
        const me = req.membership!.id;
        // Only ever move the read marker forward
        await prisma.conversationMember.updateMany({
            where: {
                conversation_id: conv.id, member_id: me,
                OR: [{ last_read_message_id: null }, { last_read_message_id: { lt: id } }],
            },
            data: { last_read_message_id: id },
        });
        emitToMember(me, 'conversation:read', { conversation_id: conv.id, message_id: id });
        res.json({ ok: true });
    })
);

async function softDelete(req: Request, message: { id: bigint; conversation_id: string }) {
    await prisma.message.update({ where: { id: message.id }, data: { deleted_at: new Date(), deleted_by: req.user!.id } });
    emitToConversation(message.conversation_id, 'message:deleted', { id: message.id, conversation_id: message.conversation_id });
}

router.delete(
    '/messages/:id',
    asyncHandler(async (req, res) => {
        const msg = await prisma.message.findFirst({
            where: { id: idParam(req.params.id), tenant_id: req.tenant!.id, deleted_at: null },
            select: { id: true, conversation_id: true, sender_member_id: true },
        });
        if (!msg) throw { status: 404, message: 'Message not found' };
        const own = msg.sender_member_id === req.membership!.id;
        if (!own) {
            const { conv, cm } = await access(req, msg.conversation_id, { allowAdmin: true });
            if (conv.type === 'direct' && !isAdmin(req)) throw { status: 403, message: 'You can only delete your own messages' };
            requireModerator(req, cm);
        }
        await softDelete(req, msg);
        if (!own) await audit(req, 'chat.message.delete', 'message', String(msg.id));
        res.status(204).end();
    })
);

router.post(
    '/messages/:id/report',
    asyncHandler(async (req, res) => {
        const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
        const msg = await prisma.message.findFirst({
            where: { id: idParam(req.params.id), tenant_id: req.tenant!.id },
            select: { id: true, conversation_id: true, sender_member_id: true },
        });
        if (!msg) throw { status: 404, message: 'Message not found' };
        await access(req, msg.conversation_id);
        if (msg.sender_member_id === req.membership!.id) throw { status: 400, message: 'You cannot report your own message' };
        await prisma.messageReport.create({
            data: { tenant_id: req.tenant!.id, message_id: msg.id, reporter_member_id: req.membership!.id, reason },
        });
        res.status(201).json({ ok: true });
    })
);

// ---------- conversation members (moderation) ----------

router.post(
    '/conversations/:id/members',
    asyncHandler(async (req, res) => {
        const { member_ids } = z.object({ member_ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
        const { conv, cm } = await access(req, String(req.params.id), { allowAdmin: true });
        if (conv.type === 'direct') throw { status: 400, message: 'Cannot add people to a direct message' };
        requireModerator(req, cm);
        const ids = await validMembers(req.tenant!.id, member_ids);
        const existing = new Set(
            (await prisma.conversationMember.findMany({ where: { conversation_id: conv.id, member_id: { in: ids } }, select: { member_id: true } }))
                .map((m) => m.member_id)
        );
        const added = ids.filter((id) => !existing.has(id));
        await prisma.conversationMember.createMany({
            data: added.map((member_id) => ({ conversation_id: conv.id, member_id, tenant_id: req.tenant!.id })),
            skipDuplicates: true,
        });
        joinConversation(added, conv.id);
        await audit(req, 'chat.members.add', 'conversation', conv.id, { member_ids: added });
        res.json({ added: added.length });
    })
);

router.patch(
    '/conversations/:id/members/:memberId',
    asyncHandler(async (req, res) => {
        const body = z
            .object({ role: z.enum(['member', 'moderator']).optional(), muted_until: z.coerce.date().nullable().optional() })
            .parse(req.body);
        const { conv, cm } = await access(req, String(req.params.id), { allowAdmin: true });
        if (conv.type === 'direct') throw { status: 400, message: 'Direct messages have no moderators' };
        requireModerator(req, cm);
        const member_id = String(req.params.memberId);
        if (member_id === req.membership!.id) throw { status: 400, message: 'You cannot change your own role or mute yourself' };
        const { count } = await prisma.conversationMember.updateMany({ where: { conversation_id: conv.id, member_id }, data: body });
        if (!count) throw { status: 404, message: 'Not a member of this conversation' };
        await audit(req, 'chat.member.update', 'conversation', conv.id, { member_id, ...body });
        res.json({ ok: true });
    })
);

router.delete(
    '/conversations/:id/members/:memberId',
    asyncHandler(async (req, res) => {
        const { conv, cm } = await access(req, String(req.params.id), { allowAdmin: true });
        const member_id = String(req.params.memberId);
        const self = member_id === req.membership!.id;
        if (conv.type === 'direct') throw { status: 400, message: 'You cannot leave a direct message' };
        if (self && conv.scope_type) throw { status: 400, message: 'Membership of this conversation is automatic' };
        if (!self) requireModerator(req, cm);

        const { count } = await prisma.conversationMember.deleteMany({ where: { conversation_id: conv.id, member_id } });
        if (!count) throw { status: 404, message: 'Not a member of this conversation' };
        leaveConversation([member_id], conv.id);
        if (!self) await audit(req, 'chat.member.remove', 'conversation', conv.id, { member_id });
        res.status(204).end();
    })
);

// ---------- reports (tenant moderation queue) ----------

router.get(
    '/reports',
    requireRole(...STAFF),
    asyncHandler(async (req, res) => {
        const status = typeof req.query.status === 'string' ? req.query.status : 'open';
        const reports = await prisma.messageReport.findMany({
            where: { tenant_id: req.tenant!.id, status },
            orderBy: { created_at: 'desc' },
            take: 200,
            select: {
                id: true, reason: true, status: true, created_at: true, resolved_at: true,
                reporter: { select: { id: true, user: { select: { full_name: true } } } },
                message: {
                    select: {
                        ...messageSelect,
                        conversation: { select: { id: true, type: true, name: true } },
                    },
                },
            },
        });
        res.json({
            reports: reports.map((r) => ({
                id: r.id, reason: r.reason, status: r.status, created_at: r.created_at, resolved_at: r.resolved_at,
                reporter: { member_id: r.reporter.id, name: r.reporter.user.full_name },
                // Moderators see the original text even if it was deleted
                message: { ...toMessage(r.message), body: r.message.body },
                conversation: r.message.conversation,
            })),
        });
    })
);

router.patch(
    '/reports/:id',
    requireRole(...STAFF),
    asyncHandler(async (req, res) => {
        const body = z.object({ status: z.enum(['dismissed', 'actioned']), delete_message: z.boolean().default(false) }).parse(req.body);
        const report = await prisma.messageReport.findFirst({
            where: { id: String(req.params.id), tenant_id: req.tenant!.id },
            select: { id: true, message: { select: { id: true, conversation_id: true, deleted_at: true } } },
        });
        if (!report) throw { status: 404, message: 'Report not found' };
        await prisma.messageReport.update({
            where: { id: report.id },
            data: { status: body.status, resolved_by: req.user!.id, resolved_at: new Date() },
        });
        if (body.delete_message && !report.message.deleted_at) await softDelete(req, report.message);
        await audit(req, 'chat.report.resolve', 'message_report', report.id, body);
        res.json({ ok: true });
    })
);

// ---------- people directory (for starting a DM) ----------

router.get(
    '/people',
    asyncHandler(async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        // Names only: phone numbers are not exposed to other members
        const people = await prisma.tenantMember.findMany({
            where: {
                tenant_id: req.tenant!.id,
                id: { not: req.membership!.id },
                status: { not: 'banned' },
                ...(q ? { user: { full_name: { contains: q } } } : {}),
            },
            orderBy: { joined_at: 'desc' },
            take: 20,
            select: { id: true, role: true, level: { select: { name: true } }, user: { select: { full_name: true } } },
        });
        res.json({ people: people.map((p) => ({ member_id: p.id, name: p.user.full_name, role: p.role, level: p.level?.name ?? null })) });
    })
);

export default router;
