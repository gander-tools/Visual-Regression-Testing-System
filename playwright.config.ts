import path from "node:path";
import { defineConfig } from "@playwright/test";
import { loadCrawlConfig } from "./src/viewport-config.ts";

const { config, configDir } = await loadCrawlConfig();

const snapshotsDir = path.resolve(
	configDir,
	config.outputDir || ".visual-regression/screenshots/baseline",
);

export default defineConfig({
	testDir: "./src",
	testMatch: "*.spec.ts",
	testIgnore: ["**/generation.spec.ts"],
	timeout: 30000,
	expect: {
		timeout: 10000,
		toHaveScreenshot: {
			maxDiffPixelRatio: config.maxDiffPixelRatio,
			animations: "disabled",
		},
	},
	retries: 0,
	reporter: [
		["./reporters/custom-reporter.ts"],
		["html", { outputFolder: ".visual-regression/report", open: "never" }],
	],
	use: {
		baseURL: process.env.BASE_URL || "https://localhost",
		ignoreHTTPSErrors: true,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
		viewport: null,
	},
	projects: [{ name: "chromium", use: {} }],
	snapshotDir: snapshotsDir,
	snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
	outputDir: ".visual-regression/screenshots/regression",
});
