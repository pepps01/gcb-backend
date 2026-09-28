import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Tests run against a separate database (gcb_test) on the same server as DATABASE_URL.
const testUrl = new URL(process.env.DATABASE_URL!);
testUrl.pathname = '/gcb_test';
process.env.TEST_DATABASE_URL = testUrl.toString();

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        globalSetup: ['test/globalSetup.ts'],
        // All files share one database
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 120_000,
        env: {
            NODE_ENV: 'test',
            DATABASE_URL: testUrl.toString(),
            LOG_LEVEL: 'silent',
            AUTH_RATE_LIMIT: '100000',
            MESSAGE_RATE_LIMIT: '100000',
            UPLOAD_DIR: 'uploads-test',
        },
    },
});
