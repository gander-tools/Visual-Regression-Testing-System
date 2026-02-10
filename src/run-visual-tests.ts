#!/usr/bin/env tsx
import type { FullConfig } from "@playwright/test";

// Dependencies interface for testing
export interface TestRunnerDeps {
	loadConfig: (
		cwd: string,
		pagePath?: string,
	) => Promise<{
		config: FullConfig;
		configFile: string;
	} | null>;
	runAllTestsWithConfig: (config: FullConfig) => Promise<number | string>;
	processExit: (code: number) => never;
	consoleLog: (...args: unknown[]) => void;
	consoleError: (...args: unknown[]) => void;
}

// Factory function that accepts dependencies
export function createRunVisualTests(deps: TestRunnerDeps) {
	return async function runVisualTests(pagePath?: string): Promise<void> {
		try {
			// 1. Validate path
			if (pagePath) {
				if (!pagePath.startsWith("/")) {
					deps.consoleError("❌ Error: Path must start with /");
					deps.consoleLog("\nUsage:");
					deps.consoleLog("  npm run visual:test           # Run all tests");
					deps.consoleLog(
						"  npm run visual:test /media    # Run tests for /media only",
					);
					deps.processExit(1);
				}
				deps.consoleLog(`🎯 Running tests for: ${pagePath}\n`);
			} else {
				deps.consoleLog("🧪 Running all visual regression tests\n");
			}

			// 2. Load Playwright config with grep filter if needed
			const configResult = await deps.loadConfig(process.cwd(), pagePath);

			if (!configResult) {
				deps.consoleError("❌ Error: Could not load playwright.config.ts");
				deps.consoleError("Make sure the file exists in the project root.");
				deps.processExit(1);
			}

			const { config } = configResult;

			// 3. Run tests via programmatic API
			const result = await deps.runAllTestsWithConfig(config);

			// 4. Convert result to exit code (Playwright may return 'passed', 'failed', 'timedout', etc.)
			const exitCode = result === "passed" || result === 0 ? 0 : 1;

			// 5. Exit with appropriate code
			deps.processExit(exitCode);
		} catch (error) {
			// If error is from processExit mock, re-throw it (don't handle it)
			if (error instanceof Error && error.message.startsWith("process.exit(")) {
				throw error;
			}

			// Handle unexpected errors
			deps.consoleError("❌ Unexpected error while running tests:");
			deps.consoleError(error);
			deps.processExit(1);
		}
	};
}

// Default implementation using real dependencies
async function createDefaultDeps(): Promise<TestRunnerDeps> {
	const { loadConfigFromFile, resolveConfigLocation } =
		// @ts-expect-error - internal Playwright API
		await import("playwright/lib/common/configLoader");

	const { runAllTestsWithConfig } =
		// @ts-expect-error - internal Playwright API
		await import("playwright/lib/runner/testRunner");

	return {
		loadConfig: async (cwd: string, pagePath?: string) => {
			const fullConfig = await loadConfigFromFile(undefined, {}, false);

			// Apply grep filter via cliGrep (same as --grep flag)
			if (pagePath) {
				const escapedPath = pagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				(fullConfig as any).cliGrep = ` ${escapedPath}(?!/) should`;
			}

			return {
				config: fullConfig,
				configFile: fullConfig.configDir
					? `${fullConfig.configDir}/playwright.config.ts`
					: "",
			};
		},
		runAllTestsWithConfig,
		processExit: (code: number) => process.exit(code),
		consoleLog: (...args: unknown[]) => console.log(...args),
		consoleError: (...args: unknown[]) => console.error(...args),
	};
}

// Export default function for CLI usage
export async function runVisualTests(pagePath?: string): Promise<void> {
	const deps = await createDefaultDeps();
	const run = createRunVisualTests(deps);
	await run(pagePath);
}

// Run directly when executed as a script
const isDirectRun =
	process.argv[1]?.endsWith("run-visual-tests.ts") ||
	process.argv[1]?.endsWith("run-visual-tests");
if (isDirectRun) {
	runVisualTests(process.argv[2]);
}
