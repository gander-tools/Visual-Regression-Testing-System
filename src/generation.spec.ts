import { expect, type Page, type Route, test } from "@playwright/test";
import {
	loadCrawlConfig,
	loadManifest,
	type ManifestData,
} from "./viewport-config.ts";

const { config, configDir, viewports } = await loadCrawlConfig();
const manifest: ManifestData = loadManifest(config, configDir);

const testBaseUrl = process.env.BASE_URL || manifest.baseUrl;

// Check if a selector is XPath (starts with // or xpath=)
function isXPathSelector(selector: string): boolean {
	return selector.startsWith("//") || selector.startsWith("xpath=");
}

// Normalize XPath selector by stripping the xpath= prefix
function normalizeXPath(selector: string): string {
	return selector.startsWith("xpath=") ? selector.slice(6) : selector;
}

// Helper to remove elements before screenshot (supports CSS and XPath selectors)
async function hideElements(page: Page, selectors: string[]): Promise<void> {
	if (!selectors || selectors.length === 0) return;

	for (const selector of selectors) {
		try {
			if (isXPathSelector(selector)) {
				const xpath = normalizeXPath(selector);
				await page.evaluate((xp: string) => {
					const result = document.evaluate(
						xp,
						document,
						null,
						XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
						null,
					);
					for (let i = 0; i < result.snapshotLength; i++) {
						const el = result.snapshotItem(i);
						if (el instanceof HTMLElement) el.remove();
					}
				}, xpath);
			} else {
				await page.evaluate((sel: string) => {
					const elements = document.querySelectorAll(sel);
					for (const el of elements) el.remove();
				}, selector);
			}
		} catch {
			// Selector might not exist, that's OK
		}
	}
}

// Build mask locators from selectors (supports CSS and XPath via Playwright locator engine)
function buildMaskLocators(page: Page, selectors: string[]) {
	if (!selectors || selectors.length === 0) return [];

	return selectors.map((selector) => {
		if (isXPathSelector(selector)) {
			const xpath = normalizeXPath(selector);
			return page.locator(`xpath=${xpath}`);
		}
		return page.locator(selector);
	});
}

// Setup external resource timeout to prevent networkidle blocking
async function setupExternalResourceTimeout(
	page: Page,
	baseUrl: string,
	timeoutMs = 20000,
): Promise<void> {
	const requestAttempts = new Map<string, number>();
	const maxAttempts = 2;

	const whitelistedDomains = config.whitelistedDomains || [];
	const blacklistedDomains = config.blacklistedDomains || [];

	await page.route("**/*", (route: Route) => {
		const url = route.request().url();

		if (url.startsWith(baseUrl) || url.startsWith("data:")) {
			route.continue();
			return;
		}

		// Block blacklisted domains immediately
		if (blacklistedDomains.some((domain) => url.includes(domain))) {
			route.abort("blockedbyclient").catch(() => {});
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

				await hideElements(page, manifest.crawlerConfig.hideSelectors);

				// Build mask locators for OOPIF and other dynamic elements
				const maskLocators = buildMaskLocators(
					page,
					manifest.crawlerConfig.maskSelectors || [],
				);

				await expect(page).toHaveScreenshot(screenshotName, {
					fullPage: true,
					maxDiffPixelRatio: config.maxDiffPixelRatio,
					mask: maskLocators,
				});
			});
		}
	});
}
