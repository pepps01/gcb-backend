import dotenv from 'dotenv';
dotenv.config();

export const env = {
    PORT: parseInt(process.env.PORT || '4000', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: process.env.JWT_SECRET!,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    KYC_PEPPER: process.env.KYC_PEPPER!,
    DEFAULT_TENANT_SLUG: process.env.DEFAULT_TENANT_SLUG || 'gyb',
    ROOT_DOMAIN: process.env.ROOT_DOMAIN || 'gcb.app',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    // Number of proxy hops to trust for req.ip (1 behind an AWS load balancer); unset = trust none
    TRUST_PROXY: parseInt(process.env.TRUST_PROXY || '0', 10),
    CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
};

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required');
if (!env.KYC_PEPPER) throw new Error('KYC_PEPPER is required');
if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET.startsWith('change-me') || env.JWT_SECRET.length < 32) {
        throw new Error('JWT_SECRET must be a random string of at least 32 characters in production');
    }
    if (env.KYC_PEPPER.startsWith('change-me')) {
        throw new Error('KYC_PEPPER must be set to a random value in production');
    }
}
