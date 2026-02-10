import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.ts";

export default defineConfig({
	...baseConfig,
	testMatch: "generation.spec.ts",
	testIgnore: [],
});
