import pino from 'pino';
import { env } from './env';

// JSON lines on stdout; in AWS the container log driver ships them to CloudWatch.
export const logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'gcb-backend', env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
});
