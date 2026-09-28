import { prisma } from '../../config/db';
import { TenantRow } from '../../middleware/tenants';
import { joinConversation, leaveConversation } from '../../realtime/io';
import { resolveLocation } from '../locations/resolve';

type Features = TenantRow['features'];
export type ScopeType = 'all' | 'lga' | 'ward';

/** The one discussion group per LGA / ward, created the first time a verified member needs it. */
async function ensureAutoGroup(tenant_id: string, scope_type: 'lga' | 'ward', scope_id: number) {
    const auto_key = `${scope_type}:${scope_id}`;
    const { lga_name, ward_name } = await resolveLocation(tenant_id, scope_type === 'lga' ? { lga_id: scope_id } : { ward_id: scope_id });
    // "Okene" → "Okene LGA", but "Sample Ward 1" stays as is
    const suffix = (name: string, word: string) => (name.toLowerCase().includes(word.toLowerCase()) ? name : `${name} ${word}`);
    const place = scope_type === 'lga'
        ? (lga_name ? suffix(lga_name, 'LGA') : `LGA ${scope_id}`)
        : (ward_name ? suffix(ward_name, 'Ward') : `Ward ${scope_id}`);
    try {
        await prisma.conversation.upsert({
            where: { tenant_id_auto_key: { tenant_id, auto_key } },
            update: {},
            create: {
                tenant_id, type: 'group', auto_key, scope_type, scope_id,
                name: place,
                description: `Everyone verified in this ${scope_type === 'lga' ? 'LGA' : 'ward'}`,
            },
        });
    } catch (e: any) {
        if (e?.code !== 'P2002') throw e; // created concurrently: fine
    }
}

/**
 * Keeps a member in exactly the scoped conversations that match them: verified members get their
 * ward and LGA groups plus any broadcast/group scoped to all, their LGA or their ward; anyone
 * no longer verified (rejected, banned) is removed. Moderators are never removed.
 */
export async function syncScopedConversations(tenant_id: string, features: Features, member_id: string) {
    const m = await prisma.tenantMember.findFirst({
        where: { id: member_id, tenant_id },
        select: { status: true, lga_id: true, ward_id: true },
    });
    if (!m) return;
    const verified = m.status === 'verified';

    if (verified && features.group_chat?.enabled) {
        if (m.lga_id) await ensureAutoGroup(tenant_id, 'lga', m.lga_id);
        if (m.ward_id) await ensureAutoGroup(tenant_id, 'ward', m.ward_id);
    }

    const scopes = verified
        ? [
            { scope_type: 'all' },
            ...(m.lga_id ? [{ scope_type: 'lga', scope_id: m.lga_id }] : []),
            ...(m.ward_id ? [{ scope_type: 'ward', scope_id: m.ward_id }] : []),
        ]
        : [];
    const target = scopes.length
        ? (await prisma.conversation.findMany({ where: { tenant_id, OR: scopes }, select: { id: true } })).map((c) => c.id)
        : [];
    const current = (
        await prisma.conversationMember.findMany({
            where: { tenant_id, member_id, conversation: { scope_type: { not: null } } },
            select: { conversation_id: true, role: true },
        })
    );
    const have = new Set(current.map((c) => c.conversation_id));
    const add = target.filter((id) => !have.has(id));
    const remove = current.filter((c) => c.role === 'member' && !target.includes(c.conversation_id)).map((c) => c.conversation_id);

    if (add.length) {
        await prisma.conversationMember.createMany({
            data: add.map((conversation_id) => ({ conversation_id, member_id, tenant_id })),
            skipDuplicates: true,
        });
    }
    if (remove.length) {
        await prisma.conversationMember.deleteMany({ where: { tenant_id, member_id, conversation_id: { in: remove } } });
    }
    add.forEach((id) => joinConversation([member_id], id));
    remove.forEach((id) => leaveConversation([member_id], id));
}

/** Verified members matching a scope, for filling a newly created scoped conversation. */
export async function membersInScope(tenant_id: string, scope_type: ScopeType, scope_id?: number | null) {
    const rows = await prisma.tenantMember.findMany({
        where: {
            tenant_id,
            status: 'verified',
            ...(scope_type === 'lga' ? { lga_id: scope_id } : scope_type === 'ward' ? { ward_id: scope_id } : {}),
        },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}
