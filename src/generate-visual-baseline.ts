#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import {
	type Browser,
	chromium,
	type Page,
	type Route,
} from "@playwright/test";
import {
	type CrawlConfig,
	type GenerationError,
	loadCrawlConfig,
	type ManifestData,
	type ViewportConfig,
} from "./viewport-config.ts";

interface ScreenshotResult {
	path: string;
	viewport: string;
	filename: string;
}

type LoadStrategy = "normal" | "extra_timeout" | "brutal";

interface StrategyConfig {
	timeout: number;
	waitUntil: "networkidle" | "domcontentloaded" | "commit";
	externalTimeout?: number;
	maxRetries?: number;
	blockExternal?: boolean;
	forceProceed?: boolean;
}

// Parse arguments: tsx script.ts [path|baseUrl]
const arg = process.argv[2];
const baseUrl = process.env.BASE_URL || "https://localhost";
let specificPath: string | null = null;

// If argument starts with /, treat it as a path to generate
if (arg?.startsWith("/")) {
	specificPath = arg;
}

const { config, configDir, viewports } = loadCrawlConfig();

// Resolve paths relative to config file location
const snapshotsDir = path.resolve(
	configDir,
	config.outputDir || "../regression.spec.ts-snapshots",
);
const manifestPath = path.resolve(
	configDir,
	config.manifestPath || "./manifest.json",
);

// Clean output directory before generating (preserve hidden files like .git, .gitignore)
const visualRegressionDir = path.resolve(configDir, "../.visual-regression");
if (fs.existsSync(visualRegressionDir)) {
	const entries = fs.readdirSync(visualRegressionDir, { withFileTypes: true });
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

function setupExternalResourceTimeout(
	page: Page,
	baseUrlParam: string,
	timeoutMs = 20000,
): void {
	const requestAttempts = new Map<string, number>();
	const maxAttempts = 2;

	const whitelistedDomains = [
		"youtube.com",
		"ytimg.com",
		"googlevideo.com",
		"ggpht.com",
		"vimeo.com",
		"vimeocdn.com",
	];

	page.route("**/*", (route: Route) => {
		const url = route.request().url();

		if (url.startsWith(baseUrlParam) || url.startsWith("data:")) {
			route.continue();
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
				console.log(`🔍 [${crawlIndex}] Crawling: ${currentPath}`);
				const response = await page.goto(this.baseUrl + currentPath, {
					timeout: this.config.timeout,
					waitUntil: "networkidle",
				});

				if (!response || !response.ok()) {
					console.warn(
						`⚠️  [${crawlIndex}] Skipping ${currentPath} - HTTP ${response?.status() || "error"}`,
					);
					continue;
				}

				this.discoveredPaths.add(currentPath);

				const links = await page.$$eval("a[href]", (anchors) =>
					anchors.map((a) => (a as HTMLAnchorElement).href),
				);
				let newLinkCount = 0;
				for (const link of links) {
					const normalizedPath = this.normalizePath(link);
					if (normalizedPath && !this.visited.has(normalizedPath)) {
						queue.push(normalizedPath);
						newLinkCount++;
					}
				}
				console.log(
					`   Found ${links.length} links, ${newLinkCount} new to queue (queue size: ${queue.length})`,
				);
			} catch (error) {
				console.warn(
					`⚠️  [${crawlIndex}] Error crawling ${currentPath}: ${(error as Error).message}`,
				);
			}
		}
		return Array.from(this.discoveredPaths).sort();
	}
}

class ScreenshotGenerator {
	private baseUrl: string;
	private viewports: ViewportConfig[];
	private outputDir: string;
	private hideSelectors: string[];

	constructor(
		baseUrl: string,
		viewports: ViewportConfig[],
		outputDir: string,
		hideSelectors: string[],
		_config: CrawlConfig,
	) {
		this.baseUrl = baseUrl;
		this.viewports = viewports;
		this.outputDir = outputDir;
		this.hideSelectors = hideSelectors || [];
	}

	getScreenshotFilename(pagePath: string, viewportName: string): string {
		const safePath =
			pagePath === "/"
				? "homepage"
				: pagePath.replace(/\//g, "-").replace(/^-/, "");
		return `${viewportName}-${safePath}.png`;
	}

	async hideElements(page: Page): Promise<void> {
		if (this.hideSelectors.length === 0) return;

		for (const selector of this.hideSelectors) {
			try {
				await page.evaluate((sel: string) => {
					const elements = document.querySelectorAll(sel);
					for (const el of elements) el.remove();
				}, selector);
			} catch {
				// Selector might not exist on this page, that's OK
			}
		}
	}

	async tryPageLoad(
		page: Page,
		url: string,
		strategy: LoadStrategy,
	): Promise<void> {
		const strategies: Record<LoadStrategy, StrategyConfig> = {
			normal: {
				timeout: 30000,
				waitUntil: "networkidle",
			},
			extra_timeout: {
				timeout: 30000,
				waitUntil: "networkidle",
				externalTimeout: 20000,
				maxRetries: 2,
			},
			brutal: {
				timeout: 120000,
				waitUntil: "commit",
				blockExternal: true,
				forceProceed: true,
			},
		};

		const strategyConfig = strategies[strategy];

		if (strategyConfig.externalTimeout) {
			setupExternalResourceTimeout(
				page,
				this.baseUrl,
				strategyConfig.externalTimeout,
			);
		}

		if (strategyConfig.blockExternal) {
			await page.route("**/*", (route: Route) => {
				const reqUrl = route.request().url();
				if (reqUrl.startsWith(this.baseUrl) || reqUrl.startsWith("data:")) {
					route.continue();
				} else {
					route.abort("blockedbyrule").catch(() => {});
				}
			});
		}

		if (strategyConfig.forceProceed) {
			try {
				await page.goto(url, {
					timeout: strategyConfig.timeout,
					waitUntil: strategyConfig.waitUntil,
				});
			} catch {
				// forceProceed: take screenshot of whatever loaded, never give up
				console.log(`   ⚡ Brutal: proceeding with partial content`);
			}
		} else {
			await page.goto(url, {
				timeout: strategyConfig.timeout,
				waitUntil: strategyConfig.waitUntil,
			});
		}
	}

	async generateScreenshots(
		browser: Browser,
		paths: string[],
	): Promise<{ results: ScreenshotResult[]; errors: GenerationError[] }> {
		const results: ScreenshotResult[] = [];
		const errors: GenerationError[] = [];
		for (const viewport of this.viewports) {
			console.log(
				`\n📸 Generating ${viewport.name} screenshots (${viewport.width}x${viewport.height}px)...`,
			);
			const context = await browser.newContext({
				ignoreHTTPSErrors: true,
				viewport: { width: viewport.width, height: viewport.height },
			});

			for (let i = 0; i < paths.length; i++) {
				const pagePath = paths[i];
				const pathIndex = `[${i + 1}/${paths.length}]`;
				const fullUrl = this.baseUrl + pagePath;
				let loaded = false;
				let page: Page | null = null;

				const strategyList: LoadStrategy[] = [
					"normal",
					"extra_timeout",
					"brutal",
				];

				for (const strategy of strategyList) {
					try {
						if (page) await page.close();
						page = await context.newPage();

						console.log(
							`   ${pathIndex} ${pagePath}${strategy !== "normal" ? ` (${strategy})` : ""}`,
						);
						await this.tryPageLoad(page, fullUrl, strategy);
						loaded = true;
						break;
					} catch (error) {
						if (strategy === strategyList[strategyList.length - 1]) {
							const errorMsg = (error as Error).message;
							console.warn(
								`   ${pathIndex} ⚠️  Failed to load ${pagePath} [${viewport.name}]: ${errorMsg}`,
							);
							errors.push({
								path: pagePath,
								viewport: viewport.name,
								stage: "load",
								message: errorMsg,
							});
						}
					}
				}

				if (!loaded) {
					if (page) await page.close();
					continue;
				}

				try {
					if (page) await this.hideElements(page);

					const filename = this.getScreenshotFilename(pagePath, viewport.name);
					const filepath = path.join(this.outputDir, filename);
					await page?.screenshot({ path: filepath, fullPage: true });
					results.push({ path: pagePath, viewport: viewport.name, filename });
				} catch (error) {
					const errorMsg = (error as Error).message;
					console.warn(
						`   ${pathIndex} ⚠️  Screenshot failed ${pagePath} [${viewport.name}]: ${errorMsg}`,
					);
					errors.push({
						path: pagePath,
						viewport: viewport.name,
						stage: "screenshot",
						message: errorMsg,
					});
				} finally {
					if (page) await page.close();
				}
			}
			await context.close();
		}
		return { results, errors };
	}
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
		screenshots: ScreenshotResult[],
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
			},
			paths: paths,
			viewports: viewports,
			errors: errors,
			metadata: {
				totalPaths: paths.length,
				totalScreenshots: screenshots.length,
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

(async () => {
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
		console.log(`🎯 Generating screenshots for: ${specificPath}\n`);
		discoveredPaths = [specificPath];
	} else {
		console.log("🕷️  Starting page discovery...\n");
		const crawler = new PageCrawler(baseUrl, config);
		discoveredPaths = await crawler.crawl(page);

		console.log(`\n✅ Discovered ${discoveredPaths.length} pages`);
		for (let i = 0; i < discoveredPaths.length; i++)
			console.log(`   [${i + 1}/${discoveredPaths.length}] ${discoveredPaths[i]}`);
	}

	fs.mkdirSync(snapshotsDir, { recursive: true });

	const generator = new ScreenshotGenerator(
		baseUrl,
		viewports,
		snapshotsDir,
		config.hideSelectors,
		config,
	);
	const { results: screenshots, errors } = await generator.generateScreenshots(
		browser,
		discoveredPaths,
	);

	console.log(`\n✅ Generated ${screenshots.length} screenshots`);

	if (errors.length > 0) {
		console.log(`\n⚠️  ${errors.length} error(s) during generation:`);
		for (const err of errors) {
			console.log(
				`   ❌ [${err.viewport}] ${err.path} — ${err.stage} failed: ${err.message}`,
			);
		}
		console.log(
			"\n   These path+viewport combinations will be skipped during testing.",
		);
	}

	const manifestWriter = new ManifestWriter(manifestPath);
	if (specificPath) {
		console.log("\n📝 Creating manifest for single path...");
	}
	manifestWriter.write(
		baseUrl,
		config,
		viewports,
		discoveredPaths,
		screenshots,
		errors,
	);

	console.log("\n🎉 Baseline generation complete!");

	await browser.close();
})();
