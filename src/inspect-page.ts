#!/usr/bin/env tsx
import { chromium } from "@playwright/test";
import { getViewportByName, loadCrawlConfig } from "./viewport-config.ts";

// Parse arguments
const args = process.argv.slice(2);
const baseUrl = process.env.BASE_URL || "https://localhost";

let pagePath: string | undefined;
let viewportName: string | undefined;

for (const arg of args) {
	if (arg.startsWith("/")) {
		pagePath = arg;
	} else if (arg.startsWith("--viewport=")) {
		viewportName = arg.replace("--viewport=", "");
	} else if (!pagePath) {
		pagePath = arg;
	}
}

if (!pagePath) {
	console.error("Error: Page path is required");
	console.log("\nUsage:");
	console.log("  npm run visual:inspect <path> [--viewport=<name>]");
	console.log("\nExamples:");
	console.log("  npm run visual:inspect /media");
	console.log("  npm run visual:inspect /media --viewport=mobile");
	console.log("  npm run visual:inspect /media --viewport=tablet");
	process.exit(1);
}

const { config, viewports } = loadCrawlConfig();

// Resolve viewport
const selectedViewport = viewportName
	? getViewportByName(viewports, viewportName)
	: viewports[0];

if (!selectedViewport) {
	console.error(
		`Error: Unknown viewport "${viewportName}". Available: ${viewports.map((v) => v.name).join(", ")}`,
	);
	process.exit(1);
}

console.log("Visual Regression Page Inspector\n");
console.log(`Base URL: ${baseUrl}`);
console.log(`Page: ${pagePath}`);
console.log(
	`Viewport: ${selectedViewport.name} (${selectedViewport.width}x${selectedViewport.height})`,
);
console.log(`Timeout: ${config.timeout}ms`);
console.log(`\nLaunching browser in DEBUG mode...`);
console.log(`   - Headed: visible browser window`);
console.log(`   - Slowmo: 500ms delay between actions`);
console.log(`   - DevTools: use browser menu to open`);
console.log(`\nTip: Check Console tab for errors, Network tab for timeouts\n`);

(async () => {
	const browser = await chromium.launch({
		headless: false, // Headed mode - visible browser
		slowMo: 500, // Slow down by 500ms
	});

	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		viewport: {
			width: selectedViewport.width,
			height: selectedViewport.height,
		},
	});

	const page = await context.newPage();

	// Log console messages
	page.on("console", (msg) => {
		const type = msg.type();
		const prefix =
			type === "error" ? "[error]" : type === "warning" ? "[warn]" : "[info]";
		console.log(`${prefix} Console [${type}]:`, msg.text());
	});

	// Log page errors
	page.on("pageerror", (error) => {
		console.error("[error] Page Error:", error.message);
	});

	// Log failed requests
	page.on("requestfailed", (request) => {
		console.error(
			"[error] Request Failed:",
			request.url(),
			request.failure()?.errorText,
		);
	});

	try {
		console.log(`Navigating to ${baseUrl}${pagePath}...`);

		const response = await page.goto(`${baseUrl}${pagePath}`, {
			waitUntil: "networkidle",
			timeout: config.timeout,
		});

		const status = response?.status();
		console.log(`Page loaded: HTTP ${status}`);

		// Hide configured selectors
		if (config.hideSelectors && config.hideSelectors.length > 0) {
			console.log(`\nHiding ${config.hideSelectors.length} selectors...`);
			for (const selector of config.hideSelectors) {
				await page.evaluate((sel: string) => {
					const elements = document.querySelectorAll(sel);
					for (const el of elements) (el as HTMLElement).style.display = "none";
				}, selector);
			}
		}

		console.log(`\nReady for inspection!`);
		console.log(`Page will stay open until you close the browser window.\n`);

		// Keep page open until manually closed
		await page.waitForEvent("close", { timeout: 0 });
	} catch (error) {
		console.error(`\nError loading page:`, (error as Error).message);
		console.log(`\nCommon issues:`);
		console.log(`   - Timeout: Page takes too long to reach networkidle`);
		console.log(`   - 404/500: Page doesn't exist or server error`);
		console.log(`   - SSL: Certificate issues (check ignoreHTTPSErrors)`);
		console.log(`\nCheck DevTools Console and Network tabs for details.\n`);

		// Keep browser open even on error for debugging
		console.log(`Browser will stay open for 30 seconds for inspection...`);
		await new Promise((resolve) => setTimeout(resolve, 30000));
	} finally {
		await browser.close();
		console.log("\nBrowser closed.");
	}
})();
