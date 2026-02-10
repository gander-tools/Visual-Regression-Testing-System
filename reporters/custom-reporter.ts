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
	}

	printsToStdio() {
		return false;
	}
}

export default CustomReporter;
