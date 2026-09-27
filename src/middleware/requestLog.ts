import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

declare global {
    namespace Express {
        interface Request {
            id?: string;
        }
    }
}

const REQUEST_ID = /^[\w.-]{1,128}$/;

/**
 * One log line per request, written when the response finishes (or the client aborts).
 * Bodies, query strings and headers are deliberately left out: they carry passwords, NIN/VIN and tokens.
 */
export function requestLog(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);

    let logged = false;
    const log = (aborted: boolean) => {
        if (logged) return;
        logged = true;
        const status = res.statusCode;
        const entry = {
            req_id: req.id,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            status,
            duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
            ip: req.ip,
            user_agent: req.headers['user-agent'],
            tenant: req.tenant?.slug,
            user_id: req.user?.id,
            role: req.membership?.role,
            bytes: Number(res.getHeader('content-length')) || undefined,
            aborted: aborted || undefined,
        };
        const level = aborted || status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        logger[level](entry, 'request');
    };

    res.on('finish', () => log(false));
    res.on('close', () => log(!res.writableFinished));
    next();
}
