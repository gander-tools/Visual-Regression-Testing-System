import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		// CLI entry point — gets commander bundled in
		"cli": "src/cli.ts",

		// Playwright runtime files — must remain separate for Playwright to discover
		"src/regression.spec": "src/regression.spec.ts",
		"src/generation.spec": "src/generation.spec.ts",
		"src/completeness.spec": "src/completeness.spec.ts",
		"reporters/custom-reporter": "reporters/custom-reporter.ts",

		// Playwright configs
		"playwright.config": "playwright.config.ts",
		"playwright.generation.config": "playwright.generation.config.ts",
	},
	format: "esm",
	outDir: "dist",
	target: "node24",
	platform: "node",
	external: [
		"@playwright/test",
		"@playwright/test/reporter",
		"playwright",
		/^playwright\//,
	],
	// Bundle commander and all local modules into each entry point
	noExternal: ["commander"],
	clean: true,
	splitting: true,
	sourcemap: false,
	dts: false,
	shims: false,
});
