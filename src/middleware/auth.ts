import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/db';

interface JwtPayload {
    sub: string;       // user id
    phone: string;
    tenant_id: string;
    role: string;
}

export function signToken(payload: JwtPayload) {
    return jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN as any });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next({ status: 401, message: 'Missing token' });

    let decoded: JwtPayload;
    try {
        decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    } catch {
        return next({ status: 401, message: 'Invalid or expired token' });
    }

    // Anything below that throws (e.g. DB down) is a server error, not a bad token.
    try {
        req.user = { id: decoded.sub, phone: decoded.phone };

        if (!req.tenant) return next({ status: 400, message: 'Tenant not resolved' });
        if (decoded.tenant_id !== req.tenant.id) {
            return next({ status: 403, message: 'Token does not belong to this tenant' });
        }

        const member = await prisma.tenantMember.findUnique({
            where: { tenant_id_user_id: { tenant_id: req.tenant.id, user_id: decoded.sub } },
            select: { id: true, role: true, level: true, tenant_id: true, status: true },
        });
        if (!member) return next({ status: 403, message: 'Not a member of this tenant' });
        if (member.status === 'banned') return next({ status: 403, message: 'Account banned' });

        req.membership = member;
        next();
    } catch (e) {
        next(e);
    }
}

export function requireRole(...allowed: string[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const role = req.membership?.role;
        if (!role || !allowed.includes(role)) {
            return next({ status: 403, message: `Requires one of: ${allowed.join(', ')}` });
        }
        next();
    };
}