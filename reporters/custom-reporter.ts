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

		// Suppress the built-in HTML reporter "To open last HTML report run:" message
		// that follows in the next reporter's onEnd call.
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			const msg = String(args[0] ?? "");
			if (
				msg.includes("To open last HTML report") ||
				msg.includes("npx playwright show-report")
			) {
				return;
			}
			originalLog(...args);
		};
	}

	printsToStdio() {
		return false;
	}
}

export default CustomReporter;
