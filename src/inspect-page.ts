#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

interface CrawlConfig {
	timeout: number;
	hideSelectors: string[];
}

// Parse arguments
const pagePath = process.argv[2];
const baseUrl = process.env.BASE_URL || "https://localhost";

if (!pagePath) {
	console.error("❌ Error: Page path is required");
	console.log("\nUsage:");
	console.log("  npm run visual:inspect <path>");
	console.log("\nExample:");
	console.log("  npm run visual:inspect /media");
	console.log("  npm run visual:inspect /artykul/feng-shui");
	process.exit(1);
}

// Load config for hideSelectors
const configPath = path.join(__dirname, "crawl-config.json");
const config: CrawlConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

console.log("🔍 Visual Regression Page Inspector\n");
console.log(`📍 Base URL: ${baseUrl}`);
console.log(`📄 Page: ${pagePath}`);
console.log(`⏱️  Timeout: ${config.timeout}ms`);
console.log(`\n🚀 Launching browser in DEBUG mode...`);
console.log(`   - Headed: visible browser window`);
console.log(`   - Slowmo: 500ms delay between actions`);
console.log(`   - DevTools: use browser menu to open`);
console.log(
	`\n💡 Tip: Check Console tab for errors, Network tab for timeouts\n`,
);

(async () => {
	const browser = await chromium.launch({
		headless: false, // Headed mode - visible browser
		slowMo: 500, // Slow down by 500ms
	});

	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		viewport: { width: 1280, height: 720 },
	});

	const page = await context.newPage();

	// Log console messages
	page.on("console", (msg) => {
		const type = msg.type();
		const emoji = type === "error" ? "❌" : type === "warning" ? "⚠️" : "ℹ️";
		console.log(`${emoji} Console [${type}]:`, msg.text());
	});

	// Log page errors
	page.on("pageerror", (error) => {
		console.error("❌ Page Error:", error.message);
	});

	// Log failed requests
	page.on("requestfailed", (request) => {
		console.error(
			"❌ Request Failed:",
			request.url(),
			request.failure()?.errorText,
		);
	});

	try {
		console.log(`🌐 Navigating to ${baseUrl}${pagePath}...`);

		const response = await page.goto(`${baseUrl}${pagePath}`, {
			waitUntil: "networkidle",
			timeout: config.timeout,
		});

		const status = response?.status();
		console.log(`✅ Page loaded: HTTP ${status}`);

		// Hide configured selectors
		if (config.hideSelectors && config.hideSelectors.length > 0) {
			console.log(`\n🙈 Hiding ${config.hideSelectors.length} selectors...`);
			for (const selector of config.hideSelectors) {
				await page.evaluate((sel: string) => {
					const elements = document.querySelectorAll(sel);
					for (const el of elements) (el as HTMLElement).style.display = "none";
				}, selector);
			}
		}

		console.log(`\n✅ Ready for inspection!`);
		console.log(`📝 Page will stay open until you close the browser window.\n`);

		// Keep page open until manually closed
		await page.waitForEvent("close", { timeout: 0 });
	} catch (error) {
		console.error(`\n❌ Error loading page:`, (error as Error).message);
		console.log(`\n💡 Common issues:`);
		console.log(`   - Timeout: Page takes too long to reach networkidle`);
		console.log(`   - 404/500: Page doesn't exist or server error`);
		console.log(`   - SSL: Certificate issues (check ignoreHTTPSErrors)`);
		console.log(`\n🔍 Check DevTools Console and Network tabs for details.\n`);

		// Keep browser open even on error for debugging
		console.log(`Browser will stay open for 30 seconds for inspection...`);
		await new Promise((resolve) => setTimeout(resolve, 30000));
	} finally {
		await browser.close();
		console.log("\n👋 Browser closed.");
	}
})();
