import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Read config to get snapshots directory
const configPath = path.join(__dirname, 'src/visual/fixtures/crawl-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Resolve snapshots path relative to config
const configDir = path.dirname(configPath);
const snapshotsDir = path.resolve(configDir, config.outputDir || '../regression.spec.ts-snapshots');

export default defineConfig({
  testDir: './src/visual',
  timeout: 30000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    }
  },
  retries: 2,
  reporter: [['html', { outputFolder: '.visual-regression/report' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'https://localhost',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: null,
  },
  projects: [{ name: 'chromium', use: {} }],
  snapshotDir: snapshotsDir,
  snapshotPathTemplate: '{snapshotDir}/{arg}{ext}',
  outputDir: '.visual-regression/screenshots/regression',
});
