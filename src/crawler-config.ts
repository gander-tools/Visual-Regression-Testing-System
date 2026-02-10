export interface CrawlConfig {
	timeout: number;
	externalResourceTimeout: number;
	ignoreQueryParams: boolean;
	blacklistPatterns: string[];
	viewports: Array<{ name: string; width: number; height?: number }>;
	outputDir: string;
	manifestPath: string;
	hideSelectors: string[];
	maxDiffPixelRatio: number;
}

export const defaultConfig: CrawlConfig = {
	timeout: 30000,
	externalResourceTimeout: 20000,
	ignoreQueryParams: true,
	blacklistPatterns: [],
	viewports: [],
	outputDir: ".visual-regression/screenshots/baseline",
	manifestPath: ".visual-regression/manifest.json",
	hideSelectors: [],
	maxDiffPixelRatio: 0.01, // 1% difference threshold
};
