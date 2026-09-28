import express, { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../config/db';
import { asyncHandler } from '../../utils/async';
import { requireAuth } from '../../middleware/auth';
import { getObject, putObject } from '../../config/storage';

const router = Router();
router.use(requireAuth);

export const UPLOAD_KINDS = ['kyc_nin_slip', 'kyc_pvc'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
// Roles that may open other members' uploads (KYC reviewers)
const REVIEWERS = ['tenant_admin', 'lga_coordinator'];

/** Detect the real type from the file's first bytes; the client's Content-Type is not trusted. */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
    if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
    return null;
}

/**
 * POST /api/uploads?kind=kyc_nin_slip — the request body is the file itself (any Content-Type).
 * PNG, JPEG or PDF up to 5MB.
 */
router.post(
    '/',
    express.raw({ type: () => true, limit: MAX_BYTES }),
    asyncHandler(async (req, res) => {
        const { kind } = z.object({ kind: z.enum(UPLOAD_KINDS) }).parse(req.query);
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || !body.length) throw { status: 400, message: 'Empty file' };
        const type = sniff(body);
        if (!type) throw { status: 415, message: 'Only PNG, JPG or PDF files are accepted' };

        const tenant_id = req.tenant!.id;
        const id = crypto.randomUUID();
        const storage_key = `${tenant_id}/${kind}/${id}.${type.ext}`;
        await putObject(storage_key, body);
        const upload = await prisma.upload.create({
            data: { id, tenant_id, member_id: req.membership!.id, kind, mime: type.mime, size_bytes: body.length, storage_key },
            select: { id: true, kind: true, mime: true, size_bytes: true, created_at: true },
        });
        res.status(201).json({ upload });
    })
);

router.get(
    '/:id',
    asyncHandler(async (req, res) => {
        const upload = await prisma.upload.findFirst({ where: { id: String(req.params.id), tenant_id: req.tenant!.id } });
        const allowed = upload && (upload.member_id === req.membership!.id || REVIEWERS.includes(req.membership!.role));
        if (!upload || !allowed) throw { status: 404, message: 'File not found' };

        const data = await getObject(upload.storage_key);
        res.set({
            'Content-Type': upload.mime,
            'Content-Disposition': `inline; filename="${upload.kind}.${upload.storage_key.split('.').pop()}"`,
            'Cache-Control': 'private, no-store',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        });
        res.send(data);
    })
);

export default router;
