import { expect, type Page, type Route, test } from "@playwright/test";
import {
	loadCrawlConfig,
	loadManifest,
	type ManifestData,
} from "./viewport-config.ts";

const { config, configDir, viewports } = await loadCrawlConfig();
const manifest: ManifestData = loadManifest(config, configDir);

const testBaseUrl = process.env.BASE_URL || manifest.baseUrl;

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

		if (url.startsWith(baseUrl) || url.startsWith("data:")) {
			route.continue();
			return;
		}

		if (whitelistedDomains.some((domain) => url.includes(domain))) {
			route.continue();
			return;
		}

		const attempts = requestAttempts.get(url) || 0;
		if (attempts >= maxAttempts) {
			route.abort("timedout").catch(() => {});
			return;
		}

		requestAttempts.set(url, attempts + 1);

		const timer = setTimeout(() => {
			route.abort("timedout").catch(() => {});
		}, timeoutMs);

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
			test(`${pagePath} should match baseline`, async ({ page }) => {
				const safePath =
					pagePath === "/"
						? "homepage"
						: pagePath.replace(/\//g, "-").replace(/^-/, "");
				const screenshotName = `${viewport.name}-${safePath}.png`;

				await setupExternalResourceTimeout(page, testBaseUrl, 20000);

				await page.goto(pagePath);
				await page.waitForLoadState("networkidle");

				// Extra delay for external embeds and lazy content to fully render
				await page.waitForTimeout(2000);

				await hideElements(page, manifest.crawlerConfig.hideSelectors);

				await expect(page).toHaveScreenshot(screenshotName, {
					fullPage: true,
					maxDiffPixelRatio: config.maxDiffPixelRatio,
				});
			});
		}
	});
}
