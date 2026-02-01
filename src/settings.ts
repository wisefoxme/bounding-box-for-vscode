import * as vscode from 'vscode';

const SECTION = 'boundingBoxEditor';

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
	const bboxDir = getBboxDirUri(workspaceFolder, scope);
	const base = imageUri.path.replace(/\.[^/.]+$/, '');
	const baseName = base.split('/').pop() ?? '';
	return vscode.Uri.joinPath(bboxDir, baseName + getBboxExtension());
}

export function onSettingsChanged(callback: () => void): vscode.Disposable {
	return vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration(SECTION)) {
			callback();
		}
	});
}
