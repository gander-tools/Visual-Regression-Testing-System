export interface CrawlConfig {
	timeout: number;
	externalResourceTimeout: number;
	ignoreQueryParams: boolean;
	blacklistPatterns: string[];
	viewports: Array<{ name: string; width: number; height?: number }>;
	outputDir: string;
	manifestPath: string;
	hideSelectors: string[];
	maskSelectors: string[];
	whitelistedDomains: string[];
	blacklistedDomains: string[];
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
	maskSelectors: [
		// OOPIF embeds - iframes from popular media services
		'iframe[src*="youtube.com"]',
		'iframe[src*="youtube-nocookie.com"]',
		'iframe[src*="vimeo.com"]',
		'iframe[src*="dailymotion.com"]',
		'iframe[src*="spotify.com"]',
		'iframe[src*="soundcloud.com"]',
		'iframe[src*="twitter.com"]',
		'iframe[src*="x.com"]',
		'iframe[src*="facebook.com"]',
		'iframe[src*="instagram.com"]',
		'iframe[src*="tiktok.com"]',
		'iframe[src*="google.com/maps"]',
	],
	whitelistedDomains: [
		"youtube.com",
		"youtube-nocookie.com",
		"ytimg.com",
		"googlevideo.com",
		"ggpht.com",
		"vimeo.com",
		"vimeocdn.com",
	],
	blacklistedDomains: [],
	maxDiffPixelRatio: 0.01, // 1% difference threshold
};
