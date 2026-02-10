#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

export function initConfig(): void {
	const rootDir = process.cwd();
	const configPath = path.join(rootDir, ".crawler-config.ts");

	if (fs.existsSync(configPath)) {
		console.error("❌ .crawler-config.ts already exists in project root.");
		console.log(
			"   Edit the existing file or delete it first to re-initialize.",
		);
		process.exit(1);
	}

	const template = `import type { CrawlConfig } from "./src/crawler-config.ts";

const config: Partial<CrawlConfig> = {
\tblacklistPatterns: [
\t\t"/_profiler/*",
\t],
\tviewports: [
\t\t{ name: "desktop", width: 1280 },
\t],
\thideSelectors: [
\t\t// CSS selectors
\t\t".sf-toolbar",
\t\t"[data-hx-include]",
\t\t".fb-share-button",
\t\t// XPath selectors (prefix with xpath= or start with //)
\t\t// "xpath=//div[@class='dynamic-content']",
\t\t// "//section[contains(@class, 'ad-banner')]",
\t],
\t// Selectors to mask in toHaveScreenshot (covered with pink box, not removed).
\t// Useful for OOPIF iframes and other dynamic content that changes between runs.
\t// Supports CSS and XPath selectors (same syntax as hideSelectors).
\t// Default config includes masks for YouTube, Vimeo, and other popular embeds.
\t// maskSelectors: [
\t// \t'iframe[src*="youtube.com"]',
\t// \t'iframe[src*="vimeo.com"]',
\t// ],
\t// Domains allowed to load external resources (e.g., embed providers).
\t// Default includes YouTube, Vimeo and related CDN domains.
\t// whitelistedDomains: [
\t// \t"youtube.com",
\t// \t"vimeo.com",
\t// ],
\t// Domains to block completely (resources will not be loaded).
\t// blacklistedDomains: [],
\t// Visual regression sensitivity: 0.01 = 1% pixel difference allowed (default)
\t// maxDiffPixelRatio: 0.01,
};

export default config;
`;

	fs.writeFileSync(configPath, template);
	console.log("✅ Created .crawler-config.ts with default configuration.");
	console.log(
		"   Edit this file to customize crawler settings for your project.",
	);
}

// Run directly when executed as a script
const isDirectRun =
	process.argv[1]?.endsWith("init-config.ts") ||
	process.argv[1]?.endsWith("init-config");
if (isDirectRun) {
	initConfig();
}
