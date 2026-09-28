import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma CLI reads the CA from a file, so a DATABASE_CA env value (see src/config/env.ts) is written to one
function datasourceUrl(): string {
    const url = process.env.DATABASE_URL!;
    const ca = process.env.DATABASE_CA?.replace(/\\n/g, '\n');
    if (!url || !ca) return url;
    const file = join(tmpdir(), 'gcb-db-ca.pem');
    writeFileSync(file, ca);
    const u = new URL(url);
    u.searchParams.set('sslcert', file);
    u.searchParams.set('sslaccept', 'strict');
    return u.toString();
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
    datasource: { url: datasourceUrl() },
});
