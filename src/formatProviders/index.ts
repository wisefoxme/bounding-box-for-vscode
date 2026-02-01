export type { BboxFormatProvider } from './types';
export { cocoProvider } from './coco';
export { yoloProvider } from './yolo';
export { pascalVocProvider } from './pascalVoc';
export { tesseractBoxProvider } from './tesseractBox';
export {
	detect,
	getProvider,
	getProviderForImage,
	setProviderForImage,
	type BboxFormatId,
} from './registry';
