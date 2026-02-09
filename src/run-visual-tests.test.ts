import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import type { FullConfig } from "@playwright/test";
import { createRunVisualTests } from "./run-visual-tests.ts";

// Dependencies that will be injected
interface TestRunnerDeps {
	loadConfig: (
		cwd: string,
		pagePath?: string,
	) => Promise<{
		config: FullConfig;
		configFile: string;
	} | null>;
	runAllTestsWithConfig: (config: FullConfig) => Promise<number>;
	processExit: (code: number) => never;
	consoleLog: (...args: unknown[]) => void;
	consoleError: (...args: unknown[]) => void;
}

describe("runVisualTests", () => {
	let mockDeps: any; // Use any to avoid mock type conflicts

	beforeEach(() => {
		// Create fresh mocks for each test
		const processExitMock = mock.fn((code: number) => {
			throw new Error(`process.exit(${code})`);
		});

		mockDeps = {
			loadConfig: mock.fn(async () => ({
				config: {
					projects: [],
					reporter: [],
					webServer: null,
				} as unknown as FullConfig,
				configFile: "playwright.config.ts",
			})),
			runAllTestsWithConfig: mock.fn(async () => 0),
			processExit: processExitMock as unknown as (code: number) => never,
			consoleLog: mock.fn(),
			consoleError: mock.fn(),
		};
	});

	describe("uses Playwright programmatic API", () => {
		it("should call runAllTestsWithConfig instead of spawn", async () => {
			// This test will fail initially because current implementation uses spawn()
			// After refactoring, it should pass by using runAllTestsWithConfig()

			const runVisualTests = createRunVisualTests(mockDeps);

			// Execute
			try {
				await runVisualTests();
			} catch {
				// Expect process.exit to be called
			}

			// Verify
			assert.equal(
				(mockDeps.loadConfig as ReturnType<typeof mock.fn>).mock.callCount(),
				1,
				"Should call loadConfig once",
			);
			assert.equal(
				(
					mockDeps.runAllTestsWithConfig as ReturnType<typeof mock.fn>
				).mock.callCount(),
				1,
				"Should call runAllTestsWithConfig once",
			);
		});

		it("should apply grep filter when pagePath is provided", async () => {
			let capturedPagePath: string | undefined;

			mockDeps.loadConfig = mock.fn(async (cwd: string, pagePath?: string) => {
				capturedPagePath = pagePath;
				return {
					config: {
						projects: [],
						reporter: [],
						webServer: null,
					} as unknown as FullConfig,
					configFile: "playwright.config.ts",
				};
			}) as any;

			const runVisualTests = createRunVisualTests(mockDeps);

			try {
				await runVisualTests("/about");
			} catch {
				// Expect process.exit
			}

			// Verify pagePath was passed to loadConfig
			assert.equal(
				capturedPagePath,
				"/about",
				"Should pass pagePath to loadConfig",
			);
		});

		it("should exit with code from runAllTestsWithConfig", async () => {
			// Create isolated mock for this test
			const isolatedProcessExit = mock.fn((code: number) => {
				throw new Error(`process.exit(${code})`);
			});

			const isolatedDeps = {
				...mockDeps,
				runAllTestsWithConfig: mock.fn(async () => 1) as any, // Simulate test failure
				processExit: isolatedProcessExit as unknown as (code: number) => never,
			};

			const runVisualTests = createRunVisualTests(isolatedDeps);

			try {
				await runVisualTests();
				assert.fail("Should have called process.exit");
			} catch (e) {
				assert.ok(
					String(e).includes("process.exit(1)"),
					"Should exit with code 1",
				);
			}

			assert.equal(
				isolatedProcessExit.mock.callCount(),
				1,
				"Should call processExit exactly once",
			);
			assert.equal(
				isolatedProcessExit.mock.calls[0].arguments[0],
				1,
				"Should exit with code 1",
			);
		});
	});

	describe("error handling", () => {
		it("should reject paths not starting with /", async () => {
			const runVisualTests = createRunVisualTests(mockDeps);

			try {
				await runVisualTests("about"); // Missing leading /
				assert.fail("Should have called process.exit");
			} catch (e) {
				assert.ok(String(e).includes("process.exit(1)"));
			}

			// Should exit before calling loadConfig
			assert.equal(
				(mockDeps.loadConfig as ReturnType<typeof mock.fn>).mock.callCount(),
				0,
			);
		});

		it("should handle missing config file", async () => {
			mockDeps.loadConfig = mock.fn(async () => null) as any; // Simulate missing config

			const runVisualTests = createRunVisualTests(mockDeps);

			try {
				await runVisualTests();
				assert.fail("Should have called process.exit");
			} catch (e) {
				assert.ok(String(e).includes("process.exit(1)"));
			}

			// Should not call runAllTestsWithConfig
			assert.equal(
				(
					mockDeps.runAllTestsWithConfig as ReturnType<typeof mock.fn>
				).mock.callCount(),
				0,
			);
		});
	});
});
