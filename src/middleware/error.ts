import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';

export function notFound(_req: Request, res: Response) {
    res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction
) {
    if (err instanceof ZodError) {
        return res.status(400).json({ error: 'Validation failed', issues: err.issues });
    }
    // Prisma unique-constraint violation (e.g. two concurrent submissions of the same NIN)
    if (err?.code === 'P2002') {
        return res.status(409).json({ error: 'Already exists' });
    }
    // Only errors we raised deliberately ({ status, message }) expose their message;
    // anything else (e.g. Postgres errors) is logged and hidden from the client.
    const status = typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) logger.error({ req_id: req.id, err }, 'unhandled error');
    const message = status >= 500 ? 'Internal Server Error' : err.message || 'Request failed';
    res.status(status).json({ error: message });
}