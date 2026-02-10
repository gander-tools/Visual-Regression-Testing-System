import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";

interface FailedTest {
	title: string;
	file: string;
	line: number;
	error: string;
}

class CustomReporter implements Reporter {
	private totalTests = 0;
	private completedTests = 0;
	private failures: FailedTest[] = [];

	onBegin(_config: FullConfig, suite: Suite) {
		this.totalTests = suite.allTests().length;
		this.completedTests = 0;
		this.failures = [];
	}

	onTestEnd(test: TestCase, result: TestResult) {
		this.completedTests++;

		if (result.status === "failed" || result.status === "timedOut") {
			this.failures.push({
				title: test.title,
				file: test.location.file,
				line: test.location.line,
				error: result.error?.message || result.status,
			});
		}

		const width = 30;
		const filled = Math.round((this.completedTests / this.totalTests) * width);
		const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
		process.stdout.write(
			`\r  [${bar}] ${this.completedTests}/${this.totalTests}`,
		);
		if (this.completedTests === this.totalTests) {
			process.stdout.write("\n");
		}
	}

	async onEnd(result: FullResult) {
		if (this.failures.length > 0) {
			console.log(`\n  ${this.failures.length} failed:`);
			for (const f of this.failures) {
				console.log(`    ${f.file}:${f.line} — ${f.title}`);
				console.log(`      ${f.error}`);
			}
		}

		console.log(`\n${"=".repeat(60)}`);
		console.log("  Testy zakonczone!");
		console.log("=".repeat(60));
		console.log(`  Status: ${result.status}`);
		console.log(`  Czas trwania: ${(result.duration / 1000).toFixed(2)}s`);
		console.log(`\n  Aby otworzyc raport HTML, uruchom:`);
		console.log("  npm run cli report");
		console.log(`${"=".repeat(60)}\n`);

		// Suppress the built-in HTML reporter "To open last HTML report run:" message.
		// Playwright writes it via process.stdout.write when process.stdin.isTTY is true.
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((
			chunk: string | Uint8Array,
			...args: unknown[]
		): boolean => {
			const str = typeof chunk === "string" ? chunk : chunk.toString();
			if (
				str.includes("To open last HTML report") ||
				str.includes("npx playwright show-report")
			) {
				return true;
			}
			return originalWrite(chunk, ...args);
		}) as typeof process.stdout.write;
	}

	printsToStdio() {
		return true;
	}
}

export default CustomReporter;
