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
	timeout: 30000,
	expect: {
		timeout: 10000,
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.01,
			animations: "disabled",
		},
	},
	retries: 2,
	reporter: [["html", { outputFolder: ".visual-regression/report" }], ["list"]],
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
