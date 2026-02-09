import { expect, type Page, type Route, test } from "@playwright/test";
import {
	hasGenerationError,
	loadCrawlConfig,
	loadManifest,
	type ManifestData,
} from "./viewport-config.ts";

const { config, configDir, viewports } = loadCrawlConfig();
const manifest: ManifestData = loadManifest(config, configDir);

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
			baseURL: manifest.baseUrl,
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

				// Setup external resource timeout before navigation
				await setupExternalResourceTimeout(page, manifest.baseUrl, 20000);

				await page.goto(pagePath);
				await page.waitForLoadState("networkidle");

				// Hide elements that should not be in screenshots
				await hideElements(page, manifest.crawlerConfig.hideSelectors);

				const safePath =
					pagePath === "/"
						? "homepage"
						: pagePath.replace(/\//g, "-").replace(/^-/, "");
				const screenshotName = `${viewport.name}-${safePath}.png`;

				await expect(page).toHaveScreenshot(screenshotName, {
					fullPage: true,
					maxDiffPixelRatio: 0.01,
				});
			});
		}
	});
}
