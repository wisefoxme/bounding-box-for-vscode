import type { Bbox } from '../bbox';

export interface BboxFormatProvider {
	readonly id: string;
	parse(content: string, imgWidth?: number, imgHeight?: number): Bbox[];
	serialize(boxes: Bbox[], imgWidth?: number, imgHeight?: number): string;
	detect(content: string): boolean;
}
