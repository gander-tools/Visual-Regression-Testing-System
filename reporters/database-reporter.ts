import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";

class DatabaseReporter implements Reporter {
	private results: Array<{
		title: string;
		file: string;
		line: number;
		status: string;
		duration: number;
		error: string | undefined;
		retry: number;
		startTime: Date;
		attachments: Array<{
			name: string;
			contentType: string;
			path: string | undefined;
			body: string | undefined;
		}>;
		annotations: Array<{ type: string; description?: string }>;
		stdout: string[];
		stderr: string[];
	}> = [];

	onBegin(_config: FullConfig, suite: Suite) {
		console.log(`Starting test run with ${suite.allTests().length} tests`);
	}

	async onTestEnd(test: TestCase, result: TestResult) {
		const testData = {
			title: test.title,
			file: test.location.file,
			line: test.location.line,
			status: result.status,
			duration: result.duration,
			error: result.error?.message,
			retry: result.retry,
			startTime: result.startTime,
			attachments: result.attachments.map((a) => ({
				name: a.name,
				contentType: a.contentType,
				path: a.path,
				body: a.body?.toString("base64"),
			})),
			annotations: test.annotations,
			stdout: result.stdout.map((s) => s.toString()),
			stderr: result.stderr.map((s) => s.toString()),
		};

		this.results.push(testData);
	}

	async onEnd(result: FullResult) {
		const summary = {
			status: result.status,
			startTime: result.startTime,
			duration: result.duration,
			totalTests: this.results.length,
			passed: this.results.filter((r) => r.status === "passed").length,
			failed: this.results.filter((r) => r.status === "failed").length,
			skipped: this.results.filter((r) => r.status === "skipped").length,
			timedOut: this.results.filter((r) => r.status === "timedOut").length,
		};

		console.log(`Test run finished: ${result.status}`);
		console.log(
			`  ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
		);
	}

	printsToStdio() {
		return false;
	}

	onStdOut(_chunk: string | Buffer, _test: TestCase, _result: TestResult) {}

	onStdErr(_chunk: string | Buffer, _test: TestCase, _result: TestResult) {}
}

export default DatabaseReporter;
