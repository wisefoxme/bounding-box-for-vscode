import { parseCoco, serializeCoco } from '../bbox';
import type { Bbox } from '../bbox';
import type { BboxFormatProvider } from './types';

const COCO_LINE = /^\d+\s+\d+\s+\d+\s+\d+/;

export const cocoProvider: BboxFormatProvider = {
	id: 'coco',
	parse(content: string, _imgWidth?: number, _imgHeight?: number): Bbox[] {
		return parseCoco(content);
	},
	serialize(boxes: Bbox[], imgWidth?: number, imgHeight?: number): string {
		return serializeCoco(boxes, imgWidth ?? 0, imgHeight ?? 0);
	},
	detect(content: string): boolean {
		const lines = content.trim().split(/\r?\n/).filter(Boolean);
		if (lines.length === 0) {return false;}
		const matching = lines.filter((line) => COCO_LINE.test(line.trim()));
		return matching.length >= Math.ceil(lines.length * 0.5);
	},
};
