import { parseYolo, serializeYolo } from '../bbox';
import type { Bbox } from '../bbox';
import type { BboxFormatProvider } from './types';

function isNormalizedFloat(s: string): boolean {
	const n = Number(s);
	return Number.isFinite(n) && n >= 0 && n <= 1;
}

export const yoloProvider: BboxFormatProvider = {
	id: 'yolo',
	parse(content: string, imgWidth = 0, imgHeight = 0): Bbox[] {
		return parseYolo(content, imgWidth, imgHeight);
	},
	serialize(boxes: Bbox[], imgWidth = 0, imgHeight = 0): string {
		return serializeYolo(boxes, imgWidth, imgHeight);
	},
	detect(content: string): boolean {
		const lines = content.trim().split(/\r?\n/).filter(Boolean);
		if (lines.length === 0) {return false;}
		let matching = 0;
		for (const line of lines) {
			const parts = line.trim().split(/\s+/);
			if (parts.length >= 5 && parts.slice(1, 5).every(isNormalizedFloat)) {
				matching++;
			}
		}
		return matching >= Math.ceil(lines.length * 0.5);
	},
};
