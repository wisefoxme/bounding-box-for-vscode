import { parsePascalVoc, serializePascalVoc } from '../bbox';
import type { Bbox } from '../bbox';
import type { BboxFormatProvider } from './types';

export const pascalVocProvider: BboxFormatProvider = {
	id: 'pascal_voc',
	parse(content: string, _imgWidth?: number, _imgHeight?: number): Bbox[] {
		return parsePascalVoc(content);
	},
	serialize(boxes: Bbox[]): string {
		return serializePascalVoc(boxes);
	},
	detect(content: string): boolean {
		const lines = content.trim().split(/\r?\n/).filter(Boolean);
		if (lines.length === 0) {return false;}
		let matching = 0;
		for (const line of lines) {
			const parts = line.trim().split(/\s+/);
			if (parts.length >= 4) {
				const x_min = Number(parts[0]);
				const y_min = Number(parts[1]);
				const x_max = Number(parts[2]);
				const y_max = Number(parts[3]);
				if (
					Number.isFinite(x_min) &&
					Number.isFinite(y_min) &&
					Number.isFinite(x_max) &&
					Number.isFinite(y_max) &&
					x_max > x_min &&
					y_max > y_min
				) {
					matching++;
				}
			}
		}
		return matching >= Math.ceil(lines.length * 0.5);
	},
};
