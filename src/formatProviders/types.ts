import type { Bbox } from '../bbox';

export interface SerializeOptions {
	yoloLabelPosition?: 'first' | 'last';
}

export interface BboxFormatProvider {
	readonly id: string;
	parse(content: string, imgWidth?: number, imgHeight?: number): Bbox[];
	serialize(boxes: Bbox[], imgWidth?: number, imgHeight?: number, options?: SerializeOptions): string;
	detect(content: string): boolean;
}
