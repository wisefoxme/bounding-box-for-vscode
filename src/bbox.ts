import type { BboxFormat } from './settings';

const DECIMAL_PLACES_FALLBACK = 2;
const DECIMAL_PLACES_CAP = 8;

/** Decimal places for coordinates = digit count of max(width, height), capped at 8. Zero dimensions use fallback. */
export function decimalPlacesForImage(imgWidth: number, imgHeight: number): number {
	const maxDim = Math.max(0, imgWidth, imgHeight);
	if (maxDim === 0) {
		return DECIMAL_PLACES_FALLBACK;
	}
	const digits = String(Math.floor(maxDim)).length;
	return Math.min(DECIMAL_PLACES_CAP, digits);
}

export function formatCoord(value: number, decimals: number): string {
	return value.toFixed(decimals);
}

export interface Bbox {
	x_min: number;
	y_min: number;
	width: number;
	height: number;
	/** Optional label/class (e.g. for COCO/YOLO). */
	label?: string;
}

/** COCO: x_min y_min width height [label]. One line per box. */
export function parseCoco(content: string): Bbox[] {
	const lines = content.trim().split(/\r?\n/).filter(Boolean);
	const boxes: Bbox[] = [];
	for (const line of lines) {
		const parts = line.trim().split(/\s+/);
		if (parts.length >= 4) {
			const x_min = Number(parts[0]);
			const y_min = Number(parts[1]);
			const width = Number(parts[2]);
			const height = Number(parts[3]);
			if (Number.isFinite(x_min) && Number.isFinite(y_min) && Number.isFinite(width) && Number.isFinite(height)) {
				boxes.push({
					x_min,
					y_min,
					width,
					height,
					label: parts.length > 4 ? parts.slice(4).join(' ') : undefined,
				});
			}
		}
	}
	return boxes;
}

export function serializeCoco(boxes: Bbox[], imgWidth = 0, imgHeight = 0): string {
	const decimals = decimalPlacesForImage(imgWidth, imgHeight);
	return boxes
		.map((b) => {
			const coords = `${formatCoord(b.x_min, decimals)} ${formatCoord(b.y_min, decimals)} ${formatCoord(b.width, decimals)} ${formatCoord(b.height, decimals)}`;
			return b.label !== undefined && b.label !== null ? `${coords} ${b.label}` : coords;
		})
		.join('\n');
}

/** YOLO: accepts "class x_center y_center width height" (class first) and "x_center y_center width height class" (label last). Normalized 0-1. */
export function parseYolo(content: string, imgWidth: number, imgHeight: number): Bbox[] {
	const lines = content.trim().split(/\r?\n/).filter(Boolean);
	const boxes: Bbox[] = [];
	const normalized = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
	for (const line of lines) {
		const parts = line.trim().split(/\s+/);
		if (parts.length >= 5 && imgWidth > 0 && imgHeight > 0) {
			const p0 = Number(parts[0]);
			const p1 = Number(parts[1]);
			const p2 = Number(parts[2]);
			const p3 = Number(parts[3]);
			const p4 = Number(parts[4]);
			let cls: string;
			let x_center: number;
			let y_center: number;
			let w: number;
			let h: number;
			const coordsFirstNormalized = normalized(p0) && normalized(p1) && normalized(p2) && normalized(p3);
			const classFirstNormalized = normalized(p1) && normalized(p2) && normalized(p3) && normalized(p4);
			const looksLikeClassFirst =
				classFirstNormalized && (Number.isInteger(p0) || !normalized(p0));
			if (looksLikeClassFirst) {
				cls = parts[0];
				x_center = p1 * imgWidth;
				y_center = p2 * imgHeight;
				w = p3 * imgWidth;
				h = p4 * imgHeight;
			} else if (coordsFirstNormalized) {
				cls = parts.slice(4).join(' ');
				x_center = p0 * imgWidth;
				y_center = p1 * imgHeight;
				w = p2 * imgWidth;
				h = p3 * imgHeight;
			} else {
				const last4Normalized =
					parts.length >= 5 &&
					normalized(Number(parts[parts.length - 4])) &&
					normalized(Number(parts[parts.length - 3])) &&
					normalized(Number(parts[parts.length - 2])) &&
					normalized(Number(parts[parts.length - 1]));
				if (last4Normalized) {
					cls = parts.slice(0, parts.length - 4).join(' ');
					x_center = Number(parts[parts.length - 4]) * imgWidth;
					y_center = Number(parts[parts.length - 3]) * imgHeight;
					w = Number(parts[parts.length - 2]) * imgWidth;
					h = Number(parts[parts.length - 1]) * imgHeight;
				} else {
					continue;
				}
			}
			if (Number.isFinite(x_center) && Number.isFinite(y_center) && Number.isFinite(w) && Number.isFinite(h)) {
				boxes.push({
					x_min: x_center - w / 2,
					y_min: y_center - h / 2,
					width: w,
					height: h,
					label: cls,
				});
			}
		}
	}
	return boxes;
}

/** YOLO: normalized 0-1. labelPosition 'last' = x_center y_center width height class; 'first' = class x_center y_center width height. */
export function serializeYolo(
	boxes: Bbox[],
	imgWidth: number,
	imgHeight: number,
	labelPosition: 'first' | 'last' = 'last',
): string {
	if (imgWidth <= 0 || imgHeight <= 0) {
		return '';
	}
	const decimals = decimalPlacesForImage(imgWidth, imgHeight);
	return boxes
		.map((b) => {
			const x_center = (b.x_min + b.width / 2) / imgWidth;
			const y_center = (b.y_min + b.height / 2) / imgHeight;
			const w = b.width / imgWidth;
			const h = b.height / imgHeight;
			const cls = b.label ?? '0';
			const coords = `${formatCoord(x_center, decimals)} ${formatCoord(y_center, decimals)} ${formatCoord(w, decimals)} ${formatCoord(h, decimals)}`;
			return labelPosition === 'first' ? `${cls} ${coords}` : `${coords} ${cls}`;
		})
		.join('\n');
}

/** Pascal VOC: x_min y_min x_max y_max [label]. */
export function parsePascalVoc(content: string): Bbox[] {
	const lines = content.trim().split(/\r?\n/).filter(Boolean);
	const boxes: Bbox[] = [];
	for (const line of lines) {
		const parts = line.trim().split(/\s+/);
		if (parts.length >= 4) {
			const x_min = Number(parts[0]);
			const y_min = Number(parts[1]);
			const x_max = Number(parts[2]);
			const y_max = Number(parts[3]);
			if (Number.isFinite(x_min) && Number.isFinite(y_min) && Number.isFinite(x_max) && Number.isFinite(y_max)) {
				boxes.push({
					x_min,
					y_min,
					width: Math.max(0, x_max - x_min),
					height: Math.max(0, y_max - y_min),
					label: parts.length > 4 ? parts.slice(4).join(' ') : undefined,
				});
			}
		}
	}
	return boxes;
}

export function serializePascalVoc(boxes: Bbox[], imgWidth = 0, imgHeight = 0): string {
	const decimals = decimalPlacesForImage(imgWidth, imgHeight);
	return boxes
		.map((b) => {
			const x_max = b.x_min + b.width;
			const y_max = b.y_min + b.height;
			const coords = `${formatCoord(b.x_min, decimals)} ${formatCoord(b.y_min, decimals)} ${formatCoord(x_max, decimals)} ${formatCoord(y_max, decimals)}`;
			return b.label !== undefined && b.label !== null ? `${coords} ${b.label}` : coords;
		})
		.join('\n');
}

export function parseBbox(content: string, format: BboxFormat, imgWidth: number, imgHeight: number): Bbox[] {
	switch (format) {
		case 'coco':
			return parseCoco(content);
		case 'yolo':
			return parseYolo(content, imgWidth, imgHeight);
		case 'pascal_voc':
			return parsePascalVoc(content);
		default:
			return parseCoco(content);
	}
}

export function serializeBbox(boxes: Bbox[], format: BboxFormat, imgWidth: number, imgHeight: number): string {
	switch (format) {
		case 'coco':
			return serializeCoco(boxes, imgWidth, imgHeight);
		case 'yolo':
			return serializeYolo(boxes, imgWidth, imgHeight);
		case 'pascal_voc':
			return serializePascalVoc(boxes, imgWidth, imgHeight);
		default:
			return serializeCoco(boxes, imgWidth, imgHeight);
	}
}
