import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/db';
import { env } from '../config/env';

export interface TenantRow {
    id: string;
    slug: string;
    name: string;
    status: string;
    plan: string;
    default_language: string;
    custom_domain: string | null;
    branding: any;
    features: Record<string, { enabled: boolean; config: any }>;
}

declare global {
    namespace Express {
        interface Request {
            tenant?: TenantRow;
            user?: { id: string; phone: string };
            membership?: { id: string; role: string; level: string | null; tenant_id: string };
        }
    }
}

function extractSlug(req: Request): string | null {
    const headerSlug = req.headers['x-tenant-slug'];
    if (typeof headerSlug === 'string' && headerSlug) return headerSlug;

    const host = (req.headers.host || '').split(':')[0];
    // e.g. gyb.gcb.app -> gyb ; gyb.localhost -> gyb ; campaign.ng -> custom domain lookup
    const parts = host.split('.');
    if (parts.length >= 3 && host.endsWith(`.${env.ROOT_DOMAIN}`)) {
        return parts[0];
    }
    if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
        return parts[0];
    }
    return null; // fall through to custom domain lookup
}

export async function tenantResolver(req: Request, _res: Response, next: NextFunction) {
    try {
        const slug = extractSlug(req);
        const host = (req.headers.host || '').split(':')[0];
        const include = { branding: true, features: true };

        const t = slug
            ? await prisma.tenant.findUnique({ where: { slug }, include })
            : await prisma.tenant.findUnique({ where: { custom_domain: host }, include });

        if (!t) return next({ status: 404, message: 'Tenant not found' });
        if (t.status !== 'active' && t.status !== 'trial') {
            return next({ status: 403, message: `Tenant is ${t.status}` });
        }

        req.tenant = {
            id: t.id,
            slug: t.slug,
            name: t.name,
            status: t.status,
            plan: t.plan,
            default_language: t.default_language,
            custom_domain: t.custom_domain,
            branding: t.branding,
            features: Object.fromEntries(
                t.features.map((f) => [f.feature_key, { enabled: f.enabled, config: f.config }])
            ),
        };
        next();
    } catch (e) {
        next(e);
    }
}

export function requireFeature(key: string) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const f = req.tenant?.features?.[key];
        if (!f?.enabled) return next({ status: 403, message: `Feature '${key}' disabled for this tenant` });
        next();
    };
}
