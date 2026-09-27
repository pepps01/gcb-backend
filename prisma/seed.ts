import { prisma } from '../src/config/db';

const FEATURES = [
    'messaging', 'group_chat', 'broadcast', 'meetings',
    'gifting', 'donations', 'situation_room', 'ebira_language',
];

async function main() {
    const tenant = await prisma.tenant.upsert({
        where: { slug: 'gyb' },
        update: {},
        create: { slug: 'gyb', name: 'GYB Campaign Hub', subdomain: 'gyb', tenant_type: 'campaign', default_language: 'en' },
    });

    await prisma.tenantBranding.upsert({
        where: { tenant_id: tenant.id },
        update: {},
        create: {
            tenant_id: tenant.id,
            app_name: 'GYB Campaign Hub',
            tagline: 'Kogi Central 2027',
            primary_color: '#0B6E4F',
            secondary_color: '#F2A900',
            sms_sender_id: 'GYB2027',
        },
    });

    for (const feature_key of FEATURES) {
        await prisma.tenantFeature.upsert({
            where: { tenant_id_feature_key: { tenant_id: tenant.id, feature_key } },
            update: {},
            create: { tenant_id: tenant.id, feature_key, enabled: true },
        });
    }
    console.log('✅ Seeded tenant "gyb"');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
