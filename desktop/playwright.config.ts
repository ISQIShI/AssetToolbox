import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests', timeout: 120000, workers: 1, reporter: 'list', outputDir: 'test-results', expect: { timeout: 15000 },
    projects: [
        { name: 'native', testMatch: /(?:native|audio)\.spec\.ts$/, outputDir: 'test-results/native' },
        { name: 'network', testMatch: /dependencies\.spec\.ts$/, outputDir: 'test-results/network' },
    ],
});
