import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type CrawlConfig, defaultConfig } from "./crawler-config.ts";

export type { CrawlConfig };

export interface ViewportConfig {
	name: string;
	width: number;
	height: number;
}

export interface GenerationError {
	path: string;
	viewport: string;
	stage: "load" | "screenshot";
	message: string;
}

export interface ManifestData {
	version: string;
	generatedAt: string;
	baseUrl: string;
	crawlerConfig: {
		timeout: number;
		ignoreQueryParams: boolean;
		blacklistPatterns: string[];
		hideSelectors: string[];
		maskSelectors: string[];
		whitelistedDomains: string[];
		blacklistedDomains: string[];
	};
	paths: string[];
	viewports: ViewportConfig[];
	errors: GenerationError[];
	metadata: {
		totalPaths: number;
		totalScreenshots: number;
		totalErrors: number;
		viewports: string[];
	};
}

const VIEWPORT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const DEFAULT_HEIGHT = 720;

/**
 * Validates that viewport names are unique lowercase alphanumeric identifiers.
 * Throws on invalid or duplicate names.
 */
function validateViewports(
	rawViewports: CrawlConfig["viewports"],
): ViewportConfig[] {
	if (!rawViewports || rawViewports.length === 0) {
		throw new Error(
			"No viewports defined in configuration. At least one viewport is required.\n" +
				"Run 'npm run cli init' to create .crawler-config.ts with default viewports.",
		);
	}

	const seen = new Set<string>();
	const validated: ViewportConfig[] = [];

	for (const vp of rawViewports) {
		if (!VIEWPORT_NAME_PATTERN.test(vp.name)) {
			throw new Error(
				`Invalid viewport name "${vp.name}". ` +
					`Names must be lowercase alphanumeric (e.g. "desktop", "mobile", "tablet-landscape").`,
			);
		}

		if (seen.has(vp.name)) {
			throw new Error(`Duplicate viewport name "${vp.name}" in config.`);
		}
		seen.add(vp.name);

		if (!Number.isInteger(vp.width) || vp.width <= 0) {
			throw new Error(
				`Viewport "${vp.name}" has invalid width: ${vp.width}. Must be a positive integer.`,
			);
		}

		if (
			vp.height !== undefined &&
			(!Number.isInteger(vp.height) || vp.height <= 0)
		) {
			throw new Error(
				`Viewport "${vp.name}" has invalid height: ${vp.height}. Must be a positive integer.`,
			);
		}

		validated.push({
			name: vp.name,
			width: vp.width,
			height: vp.height || DEFAULT_HEIGHT,
		});
	}

	return validated;
}

/**
 * Load crawler configuration by merging default config with user overrides
 * from .crawler-config.ts in the project root. All paths are relative to project root.
 */
export async function loadCrawlConfig(): Promise<{
	config: CrawlConfig;
	configDir: string;
	viewports: ViewportConfig[];
}> {
	const rootDir = process.cwd();

	let config: CrawlConfig = { ...defaultConfig };

	const userConfigPath = path.join(rootDir, ".crawler-config.ts");
	if (fs.existsSync(userConfigPath)) {
		try {
			const userModule = await import(pathToFileURL(userConfigPath).href);
			const userConfig: Partial<CrawlConfig> = userModule.default || {};
			config = { ...config, ...userConfig };
		} catch (error) {
			console.warn(
				`Warning: Failed to load .crawler-config.ts: ${(error as Error).message}`,
			);
		}
	}

	const viewports = validateViewports(config.viewports);
	return { config, configDir: rootDir, viewports };
}

/**
 * Load and parse manifest.json from the path specified in config.
 * Throws if manifest does not exist.
 */
export function loadManifest(
	config: CrawlConfig,
	configDir: string,
): ManifestData {
	const manifestPath = path.resolve(
		configDir,
		config.manifestPath || ".visual-regression/manifest.json",
	);

	if (!fs.existsSync(manifestPath)) {
		throw new Error(
			`Manifest not found at ${manifestPath}\n` +
				`Please run 'npm run cli generate' first to create baseline screenshots and manifest.`,
		);
	}

	return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

/**
 * Resolve a viewport by name from the validated list.
 */
export function getViewportByName(
	viewports: ViewportConfig[],
	name: string,
): ViewportConfig | undefined {
	return viewports.find((v) => v.name === name);
}

/**
 * Check if a specific path+viewport combination has a generation error.
 */
export function hasGenerationError(
	manifest: ManifestData,
	pagePath: string,
	viewportName: string,
): GenerationError | undefined {
	return manifest.errors?.find(
		(e) => e.path === pagePath && e.viewport === viewportName,
	);
}

/**
 * Check if a path has errors for ALL viewports (completely failed).
 */
export function hasAllViewportsErrored(
	manifest: ManifestData,
	pagePath: string,
): boolean {
	if (!manifest.errors?.length) return false;
	const pathErrors = manifest.errors.filter((e) => e.path === pagePath);
	return pathErrors.length >= manifest.viewports.length;
}
