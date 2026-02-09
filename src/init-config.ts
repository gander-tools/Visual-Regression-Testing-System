#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const configPath = path.join(rootDir, ".crawler-config.ts");

if (fs.existsSync(configPath)) {
	console.error("❌ .crawler-config.ts already exists in project root.");
	console.log("   Edit the existing file or delete it first to re-initialize.");
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
\t\t".sf-toolbar",
\t\t"[data-hx-include]",
\t\t".fb-share-button",
\t],
};

export default config;
`;

fs.writeFileSync(configPath, template);
console.log("✅ Created .crawler-config.ts with default configuration.");
console.log(
	"   Edit this file to customize crawler settings for your project.",
);
