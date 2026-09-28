import http from 'http';
import { createApp } from './app';
import { attachRealtime } from './realtime/io';
import { env } from './config/env';
import { prisma } from './config/db';
import { logger } from './config/logger';

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'GCB API listening');
});

async function shutdown() {
    logger.info('Shutting down');
    await prisma.$disconnect();
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
