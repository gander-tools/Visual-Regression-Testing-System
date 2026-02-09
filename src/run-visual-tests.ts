#!/usr/bin/env tsx
import { spawn } from "node:child_process";

// Parse arguments: tsx script.ts [path]
const pagePath = process.argv[2];

const args = ["test", "src/"];

if (pagePath) {
	// Single path mode - use grep to filter tests
	if (!pagePath.startsWith("/")) {
		console.error("❌ Error: Path must start with /");
		console.log("\nUsage:");
		console.log("  npm run visual:test           # Run all tests");
		console.log("  npm run visual:test /media    # Run tests for /media only");
		process.exit(1);
	}

	console.log(`🎯 Running tests for: ${pagePath}\n`);
	// Match exact path: space + full path + no slash after + space + should
	const escapedPath = pagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	args.push("--grep", ` ${escapedPath}(?!/) should`);
} else {
	console.log("🧪 Running all visual regression tests\n");
}

// Run playwright
const playwright = spawn("npx", ["playwright", ...args], {
	stdio: "inherit",
});

playwright.on("close", (code) => {
	process.exit(code ?? 0);
});
