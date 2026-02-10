import path from "node:path";
import { expect, type Page, type Route, test } from "@playwright/test";
import { readPngDimensions } from "./png-utils.ts";
import {
	hasGenerationError,
	loadCrawlConfig,
	loadManifest,
	type ManifestData,
} from "./viewport-config.ts";

const { config, configDir, viewports } = await loadCrawlConfig();
const manifest: ManifestData = loadManifest(config, configDir);

// Allow overriding baseUrl via BASE_URL env var (e.g., test staging against production baseline)
const testBaseUrl = process.env.BASE_URL || manifest.baseUrl;

// Get baseline directory path
const snapshotsDir = path.resolve(
	configDir,
	config.outputDir || ".visual-regression/screenshots/baseline",
);

// Helper to remove elements before screenshot
async function hideElements(page: Page, selectors: string[]): Promise<void> {
	if (!selectors || selectors.length === 0) return;

	for (const selector of selectors) {
		try {
			await page.evaluate((sel: string) => {
				const elements = document.querySelectorAll(sel);
				for (const el of elements) el.remove();
			}, selector);
		} catch {
			// Selector might not exist, that's OK
		}
	}
}

// Setup external resource timeout to prevent networkidle blocking
async function setupExternalResourceTimeout(
	page: Page,
	baseUrl: string,
	timeoutMs = 20000,
): Promise<void> {
	const requestAttempts = new Map<string, number>();
	const maxAttempts = 2;

	// Whitelisted domains for embeds (YouTube, Vimeo)
	const whitelistedDomains = [
		"youtube.com",
		"ytimg.com",
		"googlevideo.com",
		"ggpht.com",
		"vimeo.com",
		"vimeocdn.com",
	];

	await page.route("**/*", (route: Route) => {
		const url = route.request().url();

		// Allow internal resources and data URIs immediately
		if (url.startsWith(baseUrl) || url.startsWith("data:")) {
			route.continue();
			return;
		}

		// Allow whitelisted domains (YouTube, Vimeo embeds)
		if (whitelistedDomains.some((domain) => url.includes(domain))) {
			route.continue();
			return;
		}

		// Check if this URL has exceeded max attempts
		const attempts = requestAttempts.get(url) || 0;
		if (attempts >= maxAttempts) {
			route.abort("timedout").catch(() => {});
			return;
		}

		// Increment attempt counter
		requestAttempts.set(url, attempts + 1);

		// External resource - set timeout
		const timer = setTimeout(() => {
			route.abort("timedout").catch(() => {});
		}, timeoutMs);

		// Continue the request
		route
			.continue()
			.then(() => {
				clearTimeout(timer);
				requestAttempts.delete(url);
			})
			.catch(() => {
				clearTimeout(timer);
			});
	});
}

for (const viewport of viewports) {
	test.describe(`Visual Regression - ${viewport.name}`, () => {
		test.use({
			viewport: { width: viewport.width, height: viewport.height },
			baseURL: testBaseUrl,
		});

		for (const pagePath of manifest.paths) {
			const genError = hasGenerationError(manifest, pagePath, viewport.name);

			test(`${pagePath} should match baseline`, async ({ page }) => {
				if (genError) {
					test.skip(
						true,
						`Skipped: baseline not generated (${genError.stage} failed: ${genError.message})`,
					);
					return;
				}

				const safePath =
					pagePath === "/"
						? "homepage"
						: pagePath.replace(/\//g, "-").replace(/^-/, "");
				const screenshotName = `${viewport.name}-${safePath}.png`;

				// Check if baseline exists and get its dimensions
				const baselinePath = path.join(snapshotsDir, screenshotName);
				const baselineDims = readPngDimensions(baselinePath);

				// If baseline exists and has different dimensions, adjust viewport
				if (baselineDims) {
					const currentViewport = page.viewportSize();
					if (
						currentViewport &&
						(currentViewport.width !== baselineDims.width ||
							currentViewport.height !== baselineDims.height)
					) {
						await page.setViewportSize({
							width: baselineDims.width,
							height: baselineDims.height,
						});
					}
				}

				// Setup external resource timeout before navigation
				await setupExternalResourceTimeout(page, testBaseUrl, 20000);

				await page.goto(pagePath);
				await page.waitForLoadState("networkidle");

				// Hide elements that should not be in screenshots
				await hideElements(page, manifest.crawlerConfig.hideSelectors);

				await expect(page).toHaveScreenshot(screenshotName, {
					fullPage: true,
					maxDiffPixelRatio: config.maxDiffPixelRatio,
				});
			});
		}
	});
}
