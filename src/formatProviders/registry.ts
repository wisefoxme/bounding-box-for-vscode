import * as vscode from 'vscode';
import { cocoProvider } from './coco';
import { yoloProvider } from './yolo';
import { pascalVocProvider } from './pascalVoc';
import { tesseractBoxProvider } from './tesseractBox';
import type { BboxFormatProvider } from './types';

const PROVIDERS: BboxFormatProvider[] = [
	tesseractBoxProvider,
	yoloProvider,
	pascalVocProvider,
	cocoProvider,
];

const providersById = new Map<string, BboxFormatProvider>(
	PROVIDERS.map((p) => [p.id, p]),
);

const sessionCache = new Map<string, BboxFormatProvider>();

export type BboxFormatId = 'coco' | 'yolo' | 'pascal_voc';

export function detect(content: string): BboxFormatProvider | null {
	for (const provider of PROVIDERS) {
		if (provider.detect(content)) {return provider;}
	}
	return null;
}

export function getProvider(id: string): BboxFormatProvider | undefined {
	return providersById.get(id);
}

export function getProviderForImage(imageUri: vscode.Uri): BboxFormatProvider | undefined {
	return sessionCache.get(imageUri.toString());
}

export function setProviderForImage(imageUri: vscode.Uri, provider: BboxFormatProvider): void {
	sessionCache.set(imageUri.toString(), provider);
}
