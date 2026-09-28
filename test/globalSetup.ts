import { execSync } from 'child_process';
import mysql from 'mysql2/promise';

/** Creates gcb_test if needed, applies migrations, and empties every table. */
export default async function setup() {
    const url = process.env.TEST_DATABASE_URL!;
    const u = new URL(url);
    const database = u.pathname.slice(1);
    if (database !== 'gcb_test') throw new Error(`Refusing to reset ${database}`);

    const conn = await mysql.createConnection({
        host: u.hostname,
        port: Number(u.port || 3306),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);

    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

    await conn.query(`USE \`${database}\``);
    const [rows] = await conn.query(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name <> '_prisma_migrations'`,
        [database]
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { t } of rows as { t: string }[]) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.end();
}
