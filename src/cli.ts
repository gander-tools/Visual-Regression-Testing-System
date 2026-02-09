#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { Command } from "commander";

const program = new Command();

program
	.name("visual-regression")
	.description("Visual regression testing CLI")
	.version("1.0.0");

program
	.command("init")
	.description("Initialize .crawler-config.ts with default configuration")
	.action(async () => {
		const { initConfig } = await import("./init-config.ts");
		initConfig();
	});

program
	.command("generate")
	.description("Crawl pages and generate baseline screenshots")
	.argument("[path]", "specific page path to generate (e.g. /about)")
	.action(async (pagePath?: string) => {
		const { generateBaseline } = await import("./generate-visual-baseline.ts");
		await generateBaseline(pagePath);
	});

program
	.command("test")
	.description("Run visual regression tests via Playwright")
	.argument("[path]", "specific page path to test (e.g. /media)")
	.action(async (pagePath?: string) => {
		const { runVisualTests } = await import("./run-visual-tests.ts");
		runVisualTests(pagePath);
	});

program
	.command("inspect")
	.description("Open a page in headed browser for interactive debugging")
	.argument("<path>", "page path to inspect (e.g. /media)")
	.option("--viewport <name>", "viewport name (e.g. mobile, tablet)")
	.action(async (pagePath: string, options: { viewport?: string }) => {
		const { inspectPage } = await import("./inspect-page.ts");
		await inspectPage(pagePath, options.viewport);
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

program.parse();
