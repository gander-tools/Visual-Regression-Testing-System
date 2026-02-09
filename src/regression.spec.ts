import { test, expect, type Page, type Route } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface CrawlConfig {
  timeout: number;
  manifestPath: string;
  hideSelectors: string[];
}

interface ManifestData {
  baseUrl: string;
  paths: string[];
  crawlerConfig: {
    hideSelectors: string[];
  };
}

// Read config to get manifest path
const configPath = path.join(__dirname, 'crawl-config.json');
const config: CrawlConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Resolve manifest path relative to config
const configDir = path.dirname(configPath);
const manifestPath = path.resolve(configDir, config.manifestPath || './manifest.json');

// Check if manifest exists
if (!fs.existsSync(manifestPath)) {
  throw new Error(
    `Manifest not found at ${manifestPath}\n` +
    `Please run 'npm run visual:generate' first to create baseline screenshots and manifest.`
  );
}

const manifest: ManifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

const viewports = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'mobile', width: 375, height: 667 }
];

// Helper to remove elements before screenshot
async function hideElements(page: Page, selectors: string[]): Promise<void> {
  if (!selectors || selectors.length === 0) return;

  for (const selector of selectors) {
    try {
      await page.evaluate((sel: string) => {
        const elements = document.querySelectorAll(sel);
        elements.forEach(el => el.remove());
      }, selector);
    } catch {
      // Selector might not exist, that's OK
    }
  }
}

// Setup external resource timeout to prevent networkidle blocking
async function setupExternalResourceTimeout(page: Page, baseUrl: string, timeoutMs = 20000): Promise<void> {
  const requestAttempts = new Map<string, number>();
  const maxAttempts = 2;

  // Whitelisted domains for embeds (YouTube, Vimeo)
  const whitelistedDomains = [
    'youtube.com',
    'ytimg.com',
    'googlevideo.com',
    'ggpht.com',
    'vimeo.com',
    'vimeocdn.com'
  ];

  await page.route('**/*', (route: Route) => {
    const url = route.request().url();

    // Allow internal resources and data URIs immediately
    if (url.startsWith(baseUrl) || url.startsWith('data:')) {
      route.continue();
      return;
    }

    // Allow whitelisted domains (YouTube, Vimeo embeds)
    if (whitelistedDomains.some(domain => url.includes(domain))) {
      route.continue();
      return;
    }

    // Check if this URL has exceeded max attempts
    const attempts = requestAttempts.get(url) || 0;
    if (attempts >= maxAttempts) {
      route.abort('timedout').catch(() => {});
      return;
    }

    // Increment attempt counter
    requestAttempts.set(url, attempts + 1);

    // External resource - set timeout
    const timer = setTimeout(() => {
      route.abort('timedout').catch(() => {});
    }, timeoutMs);

    // Continue the request
    route.continue().then(() => {
      clearTimeout(timer);
      requestAttempts.delete(url);
    }).catch(() => {
      clearTimeout(timer);
    });
  });
}

for (const viewport of viewports) {
  test.describe(`Visual Regression - ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      baseURL: manifest.baseUrl
    });

    for (const pagePath of manifest.paths) {
      test(`${pagePath} should match baseline`, async ({ page }) => {
        // Setup external resource timeout before navigation
        await setupExternalResourceTimeout(page, manifest.baseUrl, 20000);

        await page.goto(pagePath);
        await page.waitForLoadState('networkidle');

        // Hide elements that should not be in screenshots
        await hideElements(page, manifest.crawlerConfig.hideSelectors);

        const safePath = pagePath === '/' ? 'homepage' : pagePath.replace(/\//g, '-').replace(/^-/, '');
        const screenshotName = `${viewport.name}-${safePath}.png`;

        await expect(page).toHaveScreenshot(screenshotName, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  });
}
