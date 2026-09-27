import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';
import { env } from './env';

// Money columns are BigInt (kobo); make them JSON-serialisable as plain numbers.
// Kobo amounts stay far below Number.MAX_SAFE_INTEGER.
(BigInt.prototype as any).toJSON = function () {
    return Number(this);
};

const u = new URL(env.DATABASE_URL);

export const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
        host: u.hostname,
        port: Number(u.port || 3306),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        database: u.pathname.slice(1),
        connectionLimit: 10,
    }),
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
