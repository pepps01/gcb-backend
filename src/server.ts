import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './config/db';

const app = createApp();

app.listen(env.PORT, () => {
    console.log(`🚀 GCB API on http://localhost:${env.PORT}`);
});

async function shutdown() {
    console.log('Shutting down…');
    await prisma.$disconnect();
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
