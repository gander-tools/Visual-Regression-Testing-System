import type { FullResult, Reporter } from "@playwright/test/reporter";

class CustomReporter implements Reporter {
	async onEnd(result: FullResult) {
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
		return false;
	}
}

export default CustomReporter;
