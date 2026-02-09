import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ViewportConfig {
	name: string;
	width: number;
	height: number;
}

export interface CrawlConfig {
	timeout: number;
	externalResourceTimeout: number;
	ignoreQueryParams: boolean;
	blacklistPatterns: string[];
	viewports: Array<{ name: string; width: number; height?: number }>;
	outputDir: string;
	manifestPath: string;
	hideSelectors: string[];
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
	};
	paths: string[];
	viewports: ViewportConfig[];
	metadata: {
		totalPaths: number;
		totalScreenshots: number;
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
			"No viewports defined in crawl-config.json. At least one viewport is required.",
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
 * Load and validate the crawl config from src/crawl-config.json.
 */
export function loadCrawlConfig(): {
	config: CrawlConfig;
	configDir: string;
	viewports: ViewportConfig[];
} {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const configPath = path.join(__dirname, "crawl-config.json");
	const config: CrawlConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	const configDir = path.dirname(configPath);
	const viewports = validateViewports(config.viewports);
	return { config, configDir, viewports };
}

/**
 * Load and parse manifest.json from the path specified in crawl-config.json.
 * Throws if manifest does not exist.
 */
export function loadManifest(
	config: CrawlConfig,
	configDir: string,
): ManifestData {
	const manifestPath = path.resolve(
		configDir,
		config.manifestPath || "./manifest.json",
	);

	if (!fs.existsSync(manifestPath)) {
		throw new Error(
			`Manifest not found at ${manifestPath}\n` +
				`Please run 'npm run visual:generate' first to create baseline screenshots and manifest.`,
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
