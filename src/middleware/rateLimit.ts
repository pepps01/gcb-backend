import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/** Brute-force guard for credential endpoints (login / register). */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
});

/** Per-member flood guard for sending chat messages. Mount after requireAuth. */
export const messageLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: env.MESSAGE_RATE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.membership!.id,
    message: { error: 'You are sending messages too fast' },
});
