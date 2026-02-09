#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { Command } from "commander";

export interface CliActions {
	initConfig: () => void;
	generateBaseline: (path?: string) => Promise<void>;
	runVisualTests: (path?: string) => void;
	inspectPage: (path: string, viewport?: string) => Promise<void>;
}

const defaultActions: CliActions = {
	initConfig: async () => {
		const m = await import("./init-config.ts");
		m.initConfig();
	},
	generateBaseline: async (p) => {
		const m = await import("./generate-visual-baseline.ts");
		await m.generateBaseline(p);
	},
	runVisualTests: async (p) => {
		const m = await import("./run-visual-tests.ts");
		m.runVisualTests(p);
	},
	inspectPage: async (path, viewport) => {
		const m = await import("./inspect-page.ts");
		await m.inspectPage(path, viewport);
	},
};

export function createProgram(actions: CliActions = defaultActions): Command {
	const program = new Command();

	program
		.name("npm run cli --")
		.description("Visual regression testing CLI")
		.version("1.0.0");

	program
		.command("init")
		.description("Initialize .crawler-config.ts with default configuration")
		.action(async () => {
			actions.initConfig();
		});

	program
		.command("generate")
		.description("Crawl pages and generate baseline screenshots")
		.argument("[path]", "specific page path to generate (e.g. /about)")
		.action(async (pagePath?: string) => {
			await actions.generateBaseline(pagePath);
		});

	program
		.command("test")
		.description("Run visual regression tests via Playwright")
		.argument("[path]", "specific page path to test (e.g. /media)")
		.action(async (pagePath?: string) => {
			actions.runVisualTests(pagePath);
		});

	program
		.command("inspect")
		.description("Open a page in headed browser for interactive debugging")
		.argument("<path>", "page path to inspect (e.g. /media)")
		.option("--viewport <name>", "viewport name (e.g. mobile, tablet)")
		.action(async (pagePath: string, options: { viewport?: string }) => {
			await actions.inspectPage(pagePath, options.viewport);
		});

	program
		.command("report")
		.description("Open the Playwright HTML report")
		.action(() => {
			const child = spawn(
				"npx",
				["playwright", "show-report", ".visual-regression/report"],
				{ stdio: "inherit" },
			);
			child.on("close", (code) => {
				process.exit(code ?? 0);
			});
		});

	return program;
}

// Run directly when executed as a script
const isDirectRun =
	process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli");
if (isDirectRun) {
	createProgram().parse();
}
