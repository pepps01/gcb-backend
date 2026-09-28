import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { tenantResolver } from './middleware/tenants';
import { errorHandler, notFound } from './middleware/error';
import { requestLog } from './middleware/requestLog';

import tenantRoutes from './modules/tenants/route';
import authRoutes from './modules/auth/route';
import kycRoutes from './modules/kyc/route';
import giftRoutes from './modules/gifting/route';
import incidentRoutes from './modules/incidents/route';
import memberRoutes from './modules/members/route';
import levelRoutes from './modules/levels/route';
import chatRoutes from './modules/chat/route';
import locationRoutes from './modules/locations/route';
import uploadRoutes from './modules/uploads/route';

export function createApp() {
    const app = express();
    if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

    app.use(requestLog);

    app.use(helmet());
    app.use(
        cors({
            origin: (origin, cb) => {
                if (!origin) return cb(null, true);
                cb(null, env.CORS_ORIGINS.includes(origin));
            },
            credentials: true,
        })
    );
    app.use(express.json({ limit: '5mb' }));

    // Health check stays outside tenant resolution (no DB hits)
    app.get('/health', (_req, res) => res.json({ ok: true }));

    // Every other request resolves a tenant
    app.use(tenantResolver);

    app.use('/api/tenant', tenantRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/api/kyc', kycRoutes);
    app.use('/api/gifting', giftRoutes);
    app.use('/api/incidents', incidentRoutes);
    app.use('/api/members', memberRoutes);
    app.use('/api/levels', levelRoutes);
    app.use('/api/chat', chatRoutes);
    app.use('/api/locations', locationRoutes);
    app.use('/api/uploads', uploadRoutes);

    app.use(notFound);
    app.use(errorHandler);

    return app;
}