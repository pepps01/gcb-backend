import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../src/config/db';
import { normalizePhone } from '../src/utils/phone';
import { syncScopedConversations } from '../src/modules/chat/membership';

const FEATURES = [
    'messaging', 'group_chat', 'broadcast', 'meetings',
    'gifting', 'donations', 'situation_room', 'ebira_language',
];

const LEVELS = [
    { name: 'Supporter', rank: 1, is_default: true },
    { name: 'Ward Leader', rank: 2 },
    { name: 'LGA Coordinator', rank: 3 },
];

async function main() {
    const tenant = await prisma.tenant.upsert({
        where: { slug: 'syb' },
        update: {},
        create: { slug: 'syb', name: 'SYB Hub', subdomain: 'syb', tenant_type: 'campaign', default_language: 'en' },
    });

    await prisma.tenantBranding.upsert({
        where: { tenant_id: tenant.id },
        update: {},
        create: {
            tenant_id: tenant.id,
            app_name: 'SYB Hub',
            tagline: 'Kogi Central 2027',
            // Served by gcb-frontend (public/brand/)
            logo_url: '/brand/syb-logo.png',
            primary_color: '#C8102E',
            secondary_color: '#F2A900',
            sms_sender_id: 'SYB2027',
        },
    });

    for (const feature_key of FEATURES) {
        await prisma.tenantFeature.upsert({
            where: { tenant_id_feature_key: { tenant_id: tenant.id, feature_key } },
            update: {},
            create: { tenant_id: tenant.id, feature_key, enabled: true },
        });
    }

    for (const l of LEVELS) {
        await prisma.level.upsert({
            where: { tenant_id_rank: { tenant_id: tenant.id, rank: l.rank } },
            update: {},
            create: { tenant_id: tenant.id, ...l },
        });
    }

    // Optional bootstrap admin, so someone can promote other members
    const { SEED_ADMIN_PHONE, SEED_ADMIN_PASSWORD } = process.env;
    if (SEED_ADMIN_PHONE && SEED_ADMIN_PASSWORD) {
        const phone = normalizePhone(SEED_ADMIN_PHONE);
        const user = await prisma.user.upsert({
            where: { phone },
            update: {},
            create: {
                phone,
                password_hash: await bcrypt.hash(SEED_ADMIN_PASSWORD, 10),
                full_name: process.env.SEED_ADMIN_NAME || 'Tenant Admin',
            },
        });
        const level = await prisma.level.findFirst({ where: { tenant_id: tenant.id, is_default: true } });
        await prisma.tenantMember.upsert({
            where: { tenant_id_user_id: { tenant_id: tenant.id, user_id: user.id } },
            update: { role: 'tenant_admin' },
            create: {
                tenant_id: tenant.id, user_id: user.id, role: 'tenant_admin', status: 'verified', verified_at: new Date(),
                level_id: level?.id, referral_code: `GCB${crypto.randomBytes(4).toString('hex').slice(0, 7).toUpperCase()}`,
            },
        });
        console.log(`✅ Admin ${phone} is tenant_admin of "syb"`);
    }
    // Backfill: put verified members into their ward/LGA chats (safe to re-run)
    const features = Object.fromEntries(
        (await prisma.tenantFeature.findMany({ where: { tenant_id: tenant.id } })).map((f) => [f.feature_key, { enabled: f.enabled, config: f.config }])
    );
    const verified = await prisma.tenantMember.findMany({ where: { tenant_id: tenant.id, status: 'verified' }, select: { id: true } });
    for (const m of verified) await syncScopedConversations(tenant.id, features, m.id);

    console.log('✅ Seeded tenant "syb"');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
