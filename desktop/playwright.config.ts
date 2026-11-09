import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '**/*.spec.ts', timeout: 120000, workers: 1, reporter: 'list', outputDir: 'test-results', expect: { timeout: 15000 } });
