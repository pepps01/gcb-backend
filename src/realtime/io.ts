import http from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { prisma } from '../config/db';
import { logger } from '../config/logger';
import { verifyToken } from '../middleware/auth';

/**
 * Live chat delivery. Clients connect with { auth: { token, tenant } } and are placed in
 * `m:<member id>` plus one `c:<conversation id>` room per conversation they belong to.
 * Messages are sent over REST; the server pushes them out here. With more than one API
 * instance this needs the Redis adapter (@socket.io/redis-adapter).
 */
let io: Server | null = null;

export const memberRoom = (memberId: string) => `m:${memberId}`;
export const conversationRoom = (conversationId: string) => `c:${conversationId}`;

export function attachRealtime(server: http.Server) {
    io = new Server(server, { cors: { origin: env.CORS_ORIGINS, credentials: true } });

    io.use(async (socket, next) => {
        try {
            const { token, tenant: slug } = socket.handshake.auth as { token?: string; tenant?: string };
            const claims = token ? verifyToken(token) : null;
            if (!claims || !slug) return next(new Error('unauthorized'));

            const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, status: true } });
            if (!tenant || claims.tenant_id !== tenant.id || !['active', 'trial'].includes(tenant.status)) {
                return next(new Error('unauthorized'));
            }
            const member = await prisma.tenantMember.findUnique({
                where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: claims.sub } },
                select: { id: true, status: true, user: { select: { full_name: true } } },
            });
            if (!member || member.status === 'banned') return next(new Error('unauthorized'));

            socket.data = { tenantId: tenant.id, memberId: member.id, name: member.user.full_name };
            next();
        } catch (e) {
            logger.error({ err: e }, 'socket auth failed');
            next(new Error('unavailable'));
        }
    });

    io.on('connection', async (socket) => {
        const { tenantId, memberId, name } = socket.data as { tenantId: string; memberId: string; name: string | null };
        socket.join(memberRoom(memberId));
        const rows = await prisma.conversationMember.findMany({
            where: { tenant_id: tenantId, member_id: memberId },
            select: { conversation_id: true },
        });
        socket.join(rows.map((r) => conversationRoom(r.conversation_id)));
        socket.emit('ready');

        socket.on('typing', (p: { conversation_id?: string }) => {
            const room = p?.conversation_id && conversationRoom(p.conversation_id);
            if (room && socket.rooms.has(room)) {
                socket.to(room).emit('typing', { conversation_id: p.conversation_id, member_id: memberId, name });
            }
        });
    });
    return io;
}

// No-ops when realtime isn't attached (e.g. in REST-only tests)

export function emitToConversation(conversationId: string, event: string, payload: unknown) {
    io?.to(conversationRoom(conversationId)).emit(event, payload);
}

export function emitToMember(memberId: string, event: string, payload: unknown) {
    io?.to(memberRoom(memberId)).emit(event, payload);
}

/** Subscribe members' open sockets to a conversation they just joined, and tell them. */
export function joinConversation(memberIds: string[], conversationId: string) {
    if (!io || !memberIds.length) return;
    const rooms = memberIds.map(memberRoom);
    io.in(rooms).socketsJoin(conversationRoom(conversationId));
    io.to(rooms).emit('conversation:joined', { conversation_id: conversationId });
}

export function leaveConversation(memberIds: string[], conversationId: string) {
    if (!io || !memberIds.length) return;
    const rooms = memberIds.map(memberRoom);
    io.in(rooms).socketsLeave(conversationRoom(conversationId));
    io.to(rooms).emit('conversation:left', { conversation_id: conversationId });
}

/** Drop a member's live connections, e.g. when they are banned. */
export function disconnectMember(memberId: string) {
    io?.in(memberRoom(memberId)).disconnectSockets(true);
}
