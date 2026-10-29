import sharp from 'sharp';

export type PreparedImage = {
	data: Buffer;
	/** Always JPEG: every PDF/DOCX reader supports it and it keeps files small. */
	type: 'jpg';
	width: number;
	height: number;
};

/**
 * Normalises any raster image to a bounded JPEG. Returns null when the image
 * cannot be decoded (corrupt, unsupported, SVG), so callers can list it
 * instead of failing the whole export.
 */
export async function prepareImage(
	path: string,
	mime: string,
	maxWidth = 1600
): Promise<PreparedImage | null> {
	if (mime === 'image/svg+xml') return null;
	try {
		const { data, info } = await sharp(path, { limitInputPixels: 100_000_000, failOn: 'none' })
			.rotate()
			.resize({ width: maxWidth, withoutEnlargement: true })
			.flatten({ background: '#ffffff' })
			.jpeg({ quality: 82 })
			.toBuffer({ resolveWithObject: true });
		return { data, type: 'jpg', width: info.width, height: info.height };
	} catch {
		return null;
	}
}
