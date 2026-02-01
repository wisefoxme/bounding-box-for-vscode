import * as path from 'path';
import * as vscode from 'vscode';
import type { Bbox } from './bbox';

const SECTION = 'boundingBoxEditor';

function parseDefaultBoundingBoxes(raw: unknown): Bbox[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		return [];
	}
	const result: Bbox[] = [];
	for (const entry of raw) {
		if (entry === null || typeof entry !== 'object') {
			return [];
		}
		const e = entry as Record<string, unknown>;
		const x = e.x;
		const y = e.y;
		const w = e.w;
		const h = e.h;
		if (
			typeof x !== 'number' ||
			typeof y !== 'number' ||
			typeof w !== 'number' ||
			typeof h !== 'number' ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(w) ||
			!Number.isFinite(h) ||
			w <= 0 ||
			h <= 0
		) {
			return [];
		}
		const label = e.label;
		result.push({
			x_min: x,
			y_min: y,
			width: w,
			height: h,
			label: typeof label === 'string' ? label : undefined,
		});
	}
	return result;
}

export type BboxFormat = 'coco' | 'yolo' | 'pascal_voc';

export interface BoundingBoxEditorSettings {
	imageDirectory: string;
	bboxDirectory: string;
	bboxFormat: BboxFormat;
}

export function getSettings(scope?: vscode.ConfigurationScope): BoundingBoxEditorSettings {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const imageDirectory = (config.get<string>('imageDirectory') ?? '.').trim() || '.';
	const bboxDirectory = (config.get<string>('bboxDirectory') ?? '').trim();
	const bboxFormat = (config.get<BboxFormat>('bboxFormat') ?? 'coco');
	return {
		imageDirectory,
		bboxDirectory: bboxDirectory || imageDirectory,
		bboxFormat,
	};
}

export function getImageDirUri(workspaceFolder: vscode.WorkspaceFolder, scope?: vscode.ConfigurationScope): vscode.Uri {
	const { imageDirectory } = getSettings(scope);
	const segments = imageDirectory.replace(/\\/g, '/').split('/').filter(Boolean);
	return vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
}

export function getBboxDirUri(workspaceFolder: vscode.WorkspaceFolder, scope?: vscode.ConfigurationScope): vscode.Uri {
	const { bboxDirectory } = getSettings(scope);
	const segments = bboxDirectory.replace(/\\/g, '/').split('/').filter(Boolean);
	return vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
}

export function getBboxExtension(): string {
	return '.txt';
}

export function getBboxUriForImage(
	workspaceFolder: vscode.WorkspaceFolder,
	imageUri: vscode.Uri,
	scope?: vscode.ConfigurationScope,
): vscode.Uri {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const bboxDirSetting = (config.get<string>('bboxDirectory') ?? '').trim();
	const base = imageUri.path.replace(/\.[^/.]+$/, '');
	const baseName = base.split('/').pop() ?? '';
	if (!bboxDirSetting) {
		const imageDir = path.dirname(imageUri.fsPath);
		return vscode.Uri.joinPath(vscode.Uri.file(imageDir), baseName + getBboxExtension());
	}
	const bboxDir = getBboxDirUri(workspaceFolder, scope);
	return vscode.Uri.joinPath(bboxDir, baseName + getBboxExtension());
}

export function getDefaultBoundingBoxes(scope?: vscode.ConfigurationScope): Bbox[] {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const raw = config.get<unknown>('defaultBoundingBoxes');
	return parseDefaultBoundingBoxes(raw);
}

export function onSettingsChanged(callback: () => void): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration(SECTION)) {
			callback();
		}
	});
}
