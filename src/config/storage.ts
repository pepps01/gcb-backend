import fs from 'fs/promises';
import path from 'path';
import { env } from './env';

/**
 * Private file storage. Local disk for now (UPLOAD_DIR, default ./uploads); swap these two
 * functions for S3 (PutObject / GetObject on a private bucket) in production.
 * Keys are generated server-side, never taken from the client.
 */
const root = path.resolve(env.UPLOAD_DIR);

function resolveKey(key: string) {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
    return full;
}

export async function putObject(key: string, data: Buffer) {
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: 'wx' });
}

export async function getObject(key: string): Promise<Buffer> {
    return fs.readFile(resolveKey(key));
}
