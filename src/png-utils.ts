import fs from "node:fs";

/**
 * Read PNG dimensions from file header without external dependencies.
 * PNG format stores width and height in IHDR chunk at bytes 16-23.
 */
export function readPngDimensions(filePath: string): {
	width: number;
	height: number;
} | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}

	try {
		const buffer = Buffer.alloc(24);
		const fd = fs.openSync(filePath, "r");
		fs.readSync(fd, buffer, 0, 24, 0);
		fs.closeSync(fd);

		// Verify PNG signature
		const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
		if (!buffer.subarray(0, 8).equals(pngSignature)) {
			return null;
		}

		// Read width and height from IHDR chunk (big-endian)
		const width = buffer.readUInt32BE(16);
		const height = buffer.readUInt32BE(20);

		return { width, height };
	} catch {
		return null;
	}
}
