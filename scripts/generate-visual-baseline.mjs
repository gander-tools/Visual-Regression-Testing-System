#!/usr/bin/env node
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments: node script.mjs [path|baseUrl]
const arg = process.argv[2];
const baseUrl = process.env.BASE_URL || 'https://localhost';
let specificPath = null;

// If argument starts with /, treat it as a path to generate
if (arg && arg.startsWith('/')) {
  specificPath = arg;
}

const configPath = path.join(__dirname, '../tests/visual/fixtures/crawl-config.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Resolve paths relative to config file location
const configDir = path.dirname(configPath);
const snapshotsDir = path.resolve(configDir, config.outputDir || '../regression.spec.ts-snapshots');
const manifestPath = path.resolve(configDir, config.manifestPath || './manifest.json');

// Clean output directory before generating (preserve hidden files like .git, .gitignore)
const visualRegressionDir = path.resolve(configDir, '../../../.visual-regression');
if (fs.existsSync(visualRegressionDir)) {
  const entries = fs.readdirSync(visualRegressionDir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip hidden files/directories (starting with .)
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(visualRegressionDir, entry.name);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
  console.log('🧹 Cleaned .visual-regression directory (preserved hidden files)');
}

class PageCrawler {
  constructor(baseUrl, config) {
    this.baseUrl = baseUrl;
    this.config = config;
    this.discoveredPaths = new Set();
    this.visited = new Set();
  }

  normalizePath(url) {
    try {
      const parsed = new URL(url, this.baseUrl);
      if (!parsed.href.startsWith(this.baseUrl)) return null;
      if (this.config.ignoreQueryParams) parsed.search = '';
      let urlPath = parsed.pathname;
      if (urlPath !== '/' && urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1);
      if (this.isBlacklisted(urlPath)) return null;
      return urlPath;
    } catch {
      return null;
    }
  }

  isBlacklisted(urlPath) {
    for (const pattern of this.config.blacklistPatterns) {
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (urlPath.startsWith(prefix)) return true;
      } else if (urlPath === pattern) {
        return true;
      }
    }
    return false;
  }

  setupExternalResourceTimeout(page, timeoutMs = 20000) {
    const baseUrl = this.baseUrl;
    const requestAttempts = new Map(); // Track attempts per URL
    const maxAttempts = 2; // Allow 2 attempts before permanent blocking

    // Whitelisted domains that should never be blocked (embeds, critical resources)
    const whitelistedDomains = [
      'youtube.com',
      'ytimg.com',
      'googlevideo.com',
      'ggpht.com',
      'vimeo.com',
      'vimeocdn.com'
    ];

    page.route('**/*', (route) => {
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
        route.abort('timedout').catch(() => {
          // Route may already be fulfilled/aborted, ignore error
        });
      }, timeoutMs);

      // Continue the request
      route.continue().then(() => {
        clearTimeout(timer);
        // Success - reset counter for this URL
        requestAttempts.delete(url);
      }).catch(() => {
        clearTimeout(timer);
      });
    });
  }

  async crawl(page) {
    // Setup timeout for external resources during crawling
    this.setupExternalResourceTimeout(page, this.config.externalResourceTimeout || 10000);

    const queue = ['/'];
    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (this.visited.has(currentPath)) continue;
      this.visited.add(currentPath);

      try {
        console.log(`🔍 Crawling: ${currentPath}`);
        const response = await page.goto(this.baseUrl + currentPath, {
          timeout: this.config.timeout,
          waitUntil: 'networkidle'
        });

        if (!response || !response.ok()) {
          console.warn(`⚠️  Skipping ${currentPath} - HTTP ${response?.status() || 'error'}`);
          continue;
        }

        this.discoveredPaths.add(currentPath);

        const links = await page.$$eval('a[href]', anchors => anchors.map(a => a.href));
        for (const link of links) {
          const normalizedPath = this.normalizePath(link);
          if (normalizedPath && !this.visited.has(normalizedPath)) {
            queue.push(normalizedPath);
          }
        }
      } catch (error) {
        console.warn(`⚠️  Error crawling ${currentPath}: ${error.message}`);
      }
    }
    return Array.from(this.discoveredPaths).sort();
  }
}

class ScreenshotGenerator {
  constructor(baseUrl, viewports, outputDir, hideSelectors, config) {
    this.baseUrl = baseUrl;
    this.viewports = viewports;
    this.outputDir = outputDir;
    this.hideSelectors = hideSelectors || [];
    this.config = config;
  }

  getScreenshotFilename(pagePath, viewportName) {
    const safePath = pagePath === '/' ? 'homepage' : pagePath.replace(/\//g, '-').replace(/^-/, '');
    return `${viewportName}-${safePath}.png`;
  }

  setupExternalResourceTimeout(page, timeoutMs = 20000) {
    const baseUrl = this.baseUrl;
    const requestAttempts = new Map(); // Track attempts per URL
    const maxAttempts = 2; // Allow 2 attempts before permanent blocking

    // Whitelisted domains that should never be blocked (embeds, critical resources)
    const whitelistedDomains = [
      'youtube.com',
      'ytimg.com',
      'googlevideo.com',
      'ggpht.com',
      'vimeo.com',
      'vimeocdn.com'
    ];

    page.route('**/*', (route) => {
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
        route.abort('timedout').catch(() => {
          // Route may already be fulfilled/aborted, ignore error
        });
      }, timeoutMs);

      // Continue the request
      route.continue().then(() => {
        clearTimeout(timer);
        // Success - reset counter for this URL
        requestAttempts.delete(url);
      }).catch(() => {
        clearTimeout(timer);
      });
    });
  }

  async hideElements(page) {
    if (this.hideSelectors.length === 0) return;

    for (const selector of this.hideSelectors) {
      try {
        await page.evaluate((sel) => {
          const elements = document.querySelectorAll(sel);
          elements.forEach(el => el.remove());
        }, selector);
      } catch (error) {
        // Selector might not exist on this page, that's OK
      }
    }
  }

  async tryPageLoad(page, url, strategy) {
    // Progressive fallback strategies for problematic pages with external resources
    const strategies = {
      // Level 1: Normal - full networkidle, no restrictions
      normal: {
        timeout: 30000,
        waitUntil: 'networkidle',
        externalTimeout: null
      },
      // Level 2: Extra timeout - abort external resources after 20s
      extra_timeout: {
        timeout: 30000,
        waitUntil: 'networkidle',
        externalTimeout: 20000,
        maxRetries: 2
      },
      // Level 3: Brutal - block ALL external resources, use domcontentloaded
      brutal: {
        timeout: 30000,
        waitUntil: 'domcontentloaded',
        blockExternal: true
      }
    };

    const config = strategies[strategy];

    // Setup external resource timeout if specified
    if (config.externalTimeout) {
      this.setupExternalResourceTimeout(page, config.externalTimeout);
    }

    // Block all external resources if specified (most drastic)
    if (config.blockExternal) {
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(this.baseUrl) || url.startsWith('data:')) {
          route.continue();
        } else {
          route.abort('blockedbyrule').catch(() => {});
        }
      });
    }

    await page.goto(url, {
      timeout: config.timeout,
      waitUntil: config.waitUntil
    });
  }

  async generateScreenshots(browser, paths) {
    const results = [];
    for (const viewport of this.viewports) {
      console.log(`\n📸 Generating ${viewport.name} screenshots (${viewport.width}px)...`);
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: viewport.width, height: viewport.height || 720 }
      });

      for (const pagePath of paths) {
        const fullUrl = this.baseUrl + pagePath;
        let loaded = false;
        let usedStrategy = 'normal';
        let page = null;

        // Progressive fallback: try strategies from gentle to drastic
        const strategies = ['normal', 'extra_timeout', 'brutal'];

        for (const strategy of strategies) {
          try {
            // Create fresh page for each strategy attempt to avoid route conflicts
            if (page) await page.close();
            page = await context.newPage();

            console.log(`   ${pagePath}${strategy !== 'normal' ? ` (${strategy})` : ''}`);
            await this.tryPageLoad(page, fullUrl, strategy);
            loaded = true;
            usedStrategy = strategy;
            break; // Success! No need to try more strategies
          } catch (error) {
            if (strategy === strategies[strategies.length - 1]) {
              // Last strategy also failed
              console.warn(`   ⚠️  Failed ${pagePath}: ${error.message}`);
            }
            // Try next strategy with fresh page
          }
        }

        if (!loaded) {
          if (page) await page.close();
          continue; // Skip screenshot if all strategies failed
        }

        try {
          // Hide unwanted elements before screenshot
          await this.hideElements(page);

          const filename = this.getScreenshotFilename(pagePath, viewport.name);
          const filepath = path.join(this.outputDir, filename);
          await page.screenshot({ path: filepath, fullPage: true });
          results.push({ path: pagePath, viewport: viewport.name, filename });
        } catch (error) {
          console.warn(`   ⚠️  Screenshot failed ${pagePath}: ${error.message}`);
        } finally {
          // Clean up page after screenshot
          if (page) await page.close();
        }
      }
      await context.close();
    }
    return results;
  }
}

class ManifestWriter {
  constructor(manifestPath) {
    this.manifestPath = manifestPath;
  }

  write(baseUrl, config, paths, screenshots) {
    const manifest = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      baseUrl: baseUrl,
      crawlerConfig: {
        timeout: config.timeout,
        ignoreQueryParams: config.ignoreQueryParams,
        blacklistPatterns: config.blacklistPatterns,
        hideSelectors: config.hideSelectors || []
      },
      paths: paths,
      metadata: {
        totalPaths: paths.length,
        totalScreenshots: screenshots.length,
        viewports: config.viewports.map(v => v.name)
      }
    };

    // Ensure directory exists
    const dir = path.dirname(this.manifestPath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✅ Manifest saved to ${this.manifestPath}`);
  }
}

console.log('🚀 Visual Regression Baseline Generator');
console.log(`📍 Base URL: ${baseUrl}`);
console.log(`📁 Screenshots: ${snapshotsDir}`);
console.log(`📄 Manifest: ${manifestPath}`);
if (specificPath) {
  console.log(`🎯 Single path mode: ${specificPath}`);
}
console.log('');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors']
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(baseUrl);
    if (!response?.ok()) throw new Error(`Server returned ${response?.status()}`);
    console.log(`✅ Server at ${baseUrl} is reachable\n`);
  } catch (error) {
    console.error(`❌ Cannot reach server at ${baseUrl}: ${error.message}`);
    await browser.close();
    process.exit(1);
  }

  let discoveredPaths;

  if (specificPath) {
    // Single path mode - skip crawling
    console.log(`🎯 Generating screenshots for: ${specificPath}\n`);
    discoveredPaths = [specificPath];
  } else {
    // Full crawl mode
    console.log('🕷️  Starting page discovery...\n');
    const crawler = new PageCrawler(baseUrl, config);
    discoveredPaths = await crawler.crawl(page);

    console.log(`\n✅ Discovered ${discoveredPaths.length} pages`);
    discoveredPaths.forEach(pagePath => console.log(`   - ${pagePath}`));
  }

  fs.mkdirSync(snapshotsDir, { recursive: true });

  const generator = new ScreenshotGenerator(
    baseUrl,
    config.viewports,
    snapshotsDir,
    config.hideSelectors,
    config
  );
  const screenshots = await generator.generateScreenshots(browser, discoveredPaths);

  console.log(`\n✅ Generated ${screenshots.length} screenshots`);

  // Always write manifest (even in single path mode)
  const manifestWriter = new ManifestWriter(manifestPath);
  if (specificPath) {
    // Single path mode - create/update manifest with just this path
    console.log('\n📝 Creating manifest for single path...');
  }
  manifestWriter.write(baseUrl, config, discoveredPaths, screenshots);

  console.log('\n🎉 Baseline generation complete!');

  await browser.close();
})();
