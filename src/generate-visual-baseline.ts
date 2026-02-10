#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page, type Route } from "@playwright/test";
import {
	type CrawlConfig,
	type GenerationError,
	loadCrawlConfig,
	type ManifestData,
	type ViewportConfig,
} from "./viewport-config.ts";

function setupExternalResourceTimeout(
	page: Page,
	baseUrlParam: string,
	crawlConfig: CrawlConfig,
	timeoutMs = 20000,
): void {
	const requestAttempts = new Map<string, number>();
	const maxAttempts = 2;

	const whitelistedDomains = crawlConfig.whitelistedDomains || [];
	const blacklistedDomains = crawlConfig.blacklistedDomains || [];

	page.route("**/*", (route: Route) => {
		const url = route.request().url();

		if (url.startsWith(baseUrlParam) || url.startsWith("data:")) {
			route.continue();
			return;
		}

		// Block blacklisted domains immediately
		if (blacklistedDomains.some((domain) => url.includes(domain))) {
			route.abort("blockedbyclient").catch(() => {});
			return;
		}

		if (whitelistedDomains.some((domain) => url.includes(domain))) {
			route.continue();
			return;
		}

		const attempts = requestAttempts.get(url) || 0;
		if (attempts >= maxAttempts) {
			route.abort("timedout").catch(() => {});
			return;
		}

		requestAttempts.set(url, attempts + 1);

		const timer = setTimeout(() => {
			route.abort("timedout").catch(() => {});
		}, timeoutMs);

		route
			.continue()
			.then(() => {
				clearTimeout(timer);
				requestAttempts.delete(url);
			})
			.catch(() => {
				clearTimeout(timer);
			});
	});
}

class PageCrawler {
	private baseUrl: string;
	private config: CrawlConfig;
	private discoveredPaths = new Set<string>();
	private visited = new Set<string>();

	constructor(baseUrl: string, config: CrawlConfig) {
		this.baseUrl = baseUrl;
		this.config = config;
	}

	normalizePath(url: string): string | null {
		try {
			const parsed = new URL(url, this.baseUrl);
			if (!parsed.href.startsWith(this.baseUrl)) return null;
			if (this.config.ignoreQueryParams) parsed.search = "";
			let urlPath = parsed.pathname;
			if (urlPath !== "/" && urlPath.endsWith("/"))
				urlPath = urlPath.slice(0, -1);
			if (this.isBlacklisted(urlPath)) return null;
			return urlPath;
		} catch {
			return null;
		}
	}

	isBlacklisted(urlPath: string): boolean {
		for (const pattern of this.config.blacklistPatterns) {
			if (pattern.endsWith("/*")) {
				const prefix = pattern.slice(0, -2);
				if (urlPath.startsWith(prefix)) return true;
			} else if (urlPath === pattern) {
				return true;
			}
		}
		return false;
	}

	async crawl(page: Page): Promise<string[]> {
		setupExternalResourceTimeout(
			page,
			this.baseUrl,
			this.config,
			this.config.externalResourceTimeout || 10000,
		);

		const queue: string[] = ["/"];
		let crawlIndex = 0;
		while (queue.length > 0) {
			const currentPath = queue.shift();
			if (currentPath === undefined) break;
			if (this.visited.has(currentPath)) continue;
			this.visited.add(currentPath);
			crawlIndex++;

			try {
				process.stdout.write(
					`\r  Crawling... ${crawlIndex} visited, ${this.discoveredPaths.size} found, ${queue.length} queued`,
				);
				const response = await page.goto(this.baseUrl + currentPath, {
					timeout: this.config.timeout,
					waitUntil: "networkidle",
				});

				if (!response || !response.ok()) {
					continue;
				}

				this.discoveredPaths.add(currentPath);

				const links = await page.$$eval("a[href]", (anchors) =>
					anchors.map((a) => (a as HTMLAnchorElement).href),
				);
				for (const link of links) {
					const normalizedPath = this.normalizePath(link);
					if (normalizedPath && !this.visited.has(normalizedPath)) {
						queue.push(normalizedPath);
					}
				}
			} catch {
				// errors collected silently, crawling continues
			}
		}
		process.stdout.write("\n");
		return Array.from(this.discoveredPaths).sort();
	}
}

function getScreenshotFilename(pagePath: string, viewportName: string): string {
	const safePath =
		pagePath === "/"
			? "homepage"
			: pagePath.replace(/\//g, "-").replace(/^-/, "");
	return `${viewportName}-${safePath}.png`;
}

class ManifestWriter {
	private manifestPath: string;

	constructor(manifestPath: string) {
		this.manifestPath = manifestPath;
	}

	write(
		baseUrl: string,
		config: CrawlConfig,
		viewports: ViewportConfig[],
		paths: string[],
		screenshotCount: number,
		errors: GenerationError[],
	): void {
		const manifest: ManifestData = {
			version: "1.0",
			generatedAt: new Date().toISOString(),
			baseUrl: baseUrl,
			crawlerConfig: {
				timeout: config.timeout,
				ignoreQueryParams: config.ignoreQueryParams,
				blacklistPatterns: config.blacklistPatterns,
				hideSelectors: config.hideSelectors || [],
				maskSelectors: config.maskSelectors || [],
				whitelistedDomains: config.whitelistedDomains || [],
				blacklistedDomains: config.blacklistedDomains || [],
			},
			paths: paths,
			viewports: viewports,
			errors: errors,
			metadata: {
				totalPaths: paths.length,
				totalScreenshots: screenshotCount,
				totalErrors: errors.length,
				viewports: viewports.map((v) => v.name),
			},
		};

		const dir = path.dirname(this.manifestPath);
		fs.mkdirSync(dir, { recursive: true });

		fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
		console.log(`\n✅ Manifest saved to ${this.manifestPath}`);
	}
}

function runPlaywrightGeneration(
	baseUrl: string,
	specificPath?: string,
): Promise<number> {
	return new Promise((resolve) => {
		const args = [
			"playwright",
			"test",
			"--config",
			"playwright.generation.config.ts",
			"--update-snapshots",
		];

		if (specificPath) {
			const escapedPath = specificPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			args.push("--grep", `${escapedPath}(?!/) should`);
		}

		const child = spawn("npx", args, {
			stdio: "inherit",
			env: { ...process.env, BASE_URL: baseUrl },
		});

		child.on("close", (code) => resolve(code ?? 1));
	});
}

export async function generateBaseline(specificPath?: string): Promise<void> {
	const baseUrl = process.env.BASE_URL || "https://localhost";

	const { config, configDir, viewports } = await loadCrawlConfig();

	// Resolve paths relative to project root
	const snapshotsDir = path.resolve(
		configDir,
		config.outputDir || ".visual-regression/screenshots/baseline",
	);
	const manifestPath = path.resolve(
		configDir,
		config.manifestPath || ".visual-regression/manifest.json",
	);

	// Clean output directory before generating (preserve hidden files like .git, .gitignore)
	const visualRegressionDir = path.resolve(configDir, ".visual-regression");
	if (fs.existsSync(visualRegressionDir)) {
		const entries = fs.readdirSync(visualRegressionDir, {
			withFileTypes: true,
		});
		for (const entry of entries) {
			// Skip hidden files/directories (starting with .)
			if (entry.name.startsWith(".")) continue;

			const fullPath = path.join(visualRegressionDir, entry.name);
			fs.rmSync(fullPath, { recursive: true, force: true });
		}
		console.log(
			"🧹 Cleaned .visual-regression directory (preserved hidden files)",
		);
	}

	console.log("🚀 Visual Regression Baseline Generator");
	console.log(`📍 Base URL: ${baseUrl}`);
	console.log(`📁 Screenshots: ${snapshotsDir}`);
	console.log(`📄 Manifest: ${manifestPath}`);
	console.log(
		`🖥️  Viewports: ${viewports.map((v) => `${v.name} (${v.width}x${v.height})`).join(", ")}`,
	);
	if (specificPath) {
		console.log(`🎯 Single path mode: ${specificPath}`);
	}
	console.log("");

	const browser = await chromium.launch({
		headless: true,
		args: ["--ignore-certificate-errors"],
	});

	const context = await browser.newContext({
		ignoreHTTPSErrors: true,
		viewport: { width: viewports[0].width, height: viewports[0].height },
	});

	const page = await context.newPage();

	try {
		const response = await page.goto(baseUrl);
		if (!response?.ok())
			throw new Error(`Server returned ${response?.status()}`);
		console.log(`✅ Server at ${baseUrl} is reachable\n`);
	} catch (error) {
		console.error(
			`❌ Cannot reach server at ${baseUrl}: ${(error as Error).message}`,
		);
		await browser.close();
		process.exit(1);
	}

	let discoveredPaths: string[];

	if (specificPath) {
		console.log(`🎯 Generating baselines for: ${specificPath}\n`);
		discoveredPaths = [specificPath];
	} else {
		console.log("🕷️  Starting page discovery...\n");
		const crawler = new PageCrawler(baseUrl, config);
		discoveredPaths = await crawler.crawl(page);

		console.log(`\n✅ Discovered ${discoveredPaths.length} pages`);
	}

	await browser.close();

	// Write initial manifest so regression.spec.ts can load it
	fs.mkdirSync(snapshotsDir, { recursive: true });
	const manifestWriter = new ManifestWriter(manifestPath);
	manifestWriter.write(baseUrl, config, viewports, discoveredPaths, 0, []);

	// Generate baselines via toHaveScreenshot with visual stabilization
	console.log(
		"\n📸 Generating baselines via toHaveScreenshot (with visual stabilization)...\n",
	);

	await runPlaywrightGeneration(baseUrl, specificPath);

	// Scan snapshot directory for generated baselines and determine errors
	const generatedFiles = fs.existsSync(snapshotsDir)
		? fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".png"))
		: [];

	const errors: GenerationError[] = [];
	let screenshotCount = 0;

	for (const viewport of viewports) {
		for (const pagePath of discoveredPaths) {
			const expectedFile = getScreenshotFilename(pagePath, viewport.name);
			if (generatedFiles.includes(expectedFile)) {
				screenshotCount++;
			} else {
				errors.push({
					path: pagePath,
					viewport: viewport.name,
					stage: "screenshot",
					message:
						"Baseline not generated (toHaveScreenshot failed or timed out)",
				});
			}
		}
	}

	// Rewrite manifest with final screenshot count and errors
	manifestWriter.write(
		baseUrl,
		config,
		viewports,
		discoveredPaths,
		screenshotCount,
		errors,
	);

	console.log(`\n✅ Generated ${screenshotCount} screenshots`);

	if (errors.length > 0) {
		console.log(`\n⚠️  ${errors.length} error(s) during generation:`);
		for (const err of errors) {
			console.log(`   ❌ [${err.viewport}] ${err.path} — ${err.message}`);
		}
		console.log(
			"\n   These path+viewport combinations will be skipped during testing.",
		);
	}

	console.log("\n🎉 Baseline generation complete!");
}

// Run directly when executed as a script
const isDirectRun =
	process.argv[1]?.endsWith("generate-visual-baseline.ts") ||
	process.argv[1]?.endsWith("generate-visual-baseline");
if (isDirectRun) {
	const arg = process.argv[2];
	const specificPath = arg?.startsWith("/") ? arg : undefined;
	generateBaseline(specificPath);
}
