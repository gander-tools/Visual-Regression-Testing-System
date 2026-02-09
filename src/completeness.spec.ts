import { type Page, type Route, test } from "@playwright/test";
import {
	loadCrawlConfig,
	loadManifest,
	type ManifestData,
} from "./viewport-config.ts";

const { config, configDir } = loadCrawlConfig();
const manifest: ManifestData = loadManifest(config, configDir);

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

test.describe("Visual Regression - Completeness Check", () => {
	test.use({
		baseURL: manifest.baseUrl,
	});

	test("all baseline paths should still be accessible", async ({ page }) => {
		test.setTimeout(180000); // 3 minutes for 68 pages
		const results: Array<{ path: string; status: number; ok: boolean }> = [];

		// Setup external resource timeout to handle pages like /media
		await setupExternalResourceTimeout(page, manifest.baseUrl, 20000);

		for (const pagePath of manifest.paths) {
			const response = await page.goto(pagePath, { waitUntil: "networkidle" });
			const status = response?.status() ?? 0;
			results.push({ path: pagePath, status, ok: status === 200 });
		}

		const failures = results.filter((r) => !r.ok);

		if (failures.length > 0) {
			const failureReport = failures
				.map((f) => `  - ${f.path} returned ${f.status}`)
				.join("\n");
			throw new Error(
				`${failures.length} baseline path(s) are no longer accessible:\n${failureReport}`,
			);
		}

		console.log(`✓ All ${manifest.paths.length} baseline paths are accessible`);
	});
});
