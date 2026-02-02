import { decimalPlacesForImage, formatCoord, type Bbox } from '../bbox';
import type { BboxFormatProvider } from './types';

function parseTesseractBoxLine(line: string): Bbox | null {
	const parts = line.trim().split(/\s+/);
	if (parts.length < 5) {return null;}
	let x_min: number;
	let y_min: number;
	let x_max: number;
	let y_max: number;
	let label: string;
	if (parts.length >= 6) {
		if (Number.isFinite(Number(parts[5]))) {
			label = parts[0];
			x_min = Number(parts[1]);
			y_min = Number(parts[2]);
			x_max = Number(parts[3]);
			y_max = Number(parts[4]);
		} else if (Number.isFinite(Number(parts[1]))) {
			label = parts[0];
			x_min = Number(parts[2]);
			y_min = Number(parts[3]);
			x_max = Number(parts[4]);
			y_max = Number(parts[5]);
		} else {
			const last4 = parts.slice(-4).map(Number);
			if (last4.some((n) => !Number.isFinite(n))) {return null;}
			[x_min, y_min, x_max, y_max] = last4;
			label = parts.slice(0, -4).join(' ').trim();
		}
	} else {
		const last4 = parts.slice(-4).map(Number);
		if (last4.some((n) => !Number.isFinite(n))) {return null;}
		[x_min, y_min, x_max, y_max] = last4;
		label = parts.slice(0, -4).join(' ').trim();
	}
	if (!Number.isFinite(x_min) || !Number.isFinite(y_min) || !Number.isFinite(x_max) || !Number.isFinite(y_max))
		{return null;}
	return {
		x_min,
		y_min,
		width: Math.max(0, x_max - x_min),
		height: Math.max(0, y_max - y_min),
		label: label || undefined,
	};
}

function detectTesseractLine(line: string): boolean {
	const parts = line.trim().split(/\s+/);
	if (parts.length < 5) {return false;}
	const firstToken = parts[0];
	if (/^\d+\.?\d*$/.test(firstToken) && Number.isFinite(Number(firstToken))) {
		return false;
	}
	if (parts.length >= 6) {
		if (Number.isFinite(Number(parts[5]))) {
			return (
				Number.isFinite(Number(parts[1])) &&
				Number.isFinite(Number(parts[2])) &&
				Number.isFinite(Number(parts[3])) &&
				Number.isFinite(Number(parts[4]))
			);
		}
		return (
			Number.isFinite(Number(parts[2])) &&
			Number.isFinite(Number(parts[3])) &&
			Number.isFinite(Number(parts[4])) &&
			Number.isFinite(Number(parts[5]))
		);
	}
	const last4 = parts.slice(-4);
	return last4.every((p) => /^-?\d+\.?\d*$/.test(p) && Number.isFinite(Number(p))) && parts.length > 4;
}

export const tesseractBoxProvider: BboxFormatProvider = {
	id: 'tesseract_box',
	parse(content: string, _imgWidth?: number, _imgHeight?: number): Bbox[] {
		const lines = content.trim().split(/\r?\n/).filter(Boolean);
		const boxes: Bbox[] = [];
		for (const line of lines) {
			const box = parseTesseractBoxLine(line);
			if (box) {boxes.push(box);}
		}
		return boxes;
	},
	serialize(boxes: Bbox[], _imgWidth?: number, _imgHeight?: number, _options?: unknown): string {
		const decimals = decimalPlacesForImage(_imgWidth ?? 0, _imgHeight ?? 0);
		return boxes
			.map((b) => {
				const x_max = b.x_min + b.width;
				const y_max = b.y_min + b.height;
				const label = b.label ?? '';
				return `${label} ${formatCoord(b.x_min, decimals)} ${formatCoord(b.y_min, decimals)} ${formatCoord(x_max, decimals)} ${formatCoord(y_max, decimals)} 0`;
			})
			.join('\n');
	},
	detect(content: string): boolean {
		const lines = content.trim().split(/\r?\n/).filter(Boolean);
		if (lines.length === 0) {return false;}
		const matching = lines.filter(detectTesseractLine);
		return matching.length >= Math.ceil(lines.length * 0.5);
	},
};
