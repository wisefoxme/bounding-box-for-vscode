import * as path from 'path';
import * as vscode from 'vscode';
import type { Bbox } from './bbox';
import { detect, getProvider, setProviderForImage } from './formatProviders';

const SECTION = 'boundingBoxEditor';

function normalizeExtension(ext: string): string {
	const s = ext.trim();
	return s && !s.startsWith('.') ? '.' + s : s;
}

function parseAllowedBoundingBoxFileExtensions(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return ['.txt'];
	}
	if (raw.length === 0) {
		return [];
	}
	const normalized = raw
		.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
		.map((e) => {
			const s = e.trim();
			return s === '*' ? '*' : normalizeExtension(s);
		});
	return normalized.length > 0 ? normalized : ['.txt'];
}

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
	allowedBoundingBoxFileExtensions: string[];
}

export function getSettings(scope?: vscode.ConfigurationScope): BoundingBoxEditorSettings {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const imageDirectory = (config.get<string>('imageDirectory') ?? '.').trim() || '.';
	const bboxDirectory = (config.get<string>('bboxDirectory') ?? '').trim();
	const bboxFormat = (config.get<BboxFormat>('bboxFormat') ?? 'coco');
	const allowedBoundingBoxFileExtensions = parseAllowedBoundingBoxFileExtensions(
		config.get<unknown>('allowedBoundingBoxFileExtensions'),
	);
	return {
		imageDirectory,
		bboxDirectory: bboxDirectory || imageDirectory,
		bboxFormat,
		allowedBoundingBoxFileExtensions,
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

/** First allowed extension for primary bbox path, or ".txt" when empty or "*". */
export function getBboxExtension(scope?: vscode.ConfigurationScope): string {
	const allowed = getAllowedBoundingBoxFileExtensions(scope);
	if (allowed.length === 0 || allowed.includes('*')) {
		return '.txt';
	}
	return allowed[0];
}

export function getAllowedBoundingBoxFileExtensions(scope?: vscode.ConfigurationScope): string[] {
	return parseAllowedBoundingBoxFileExtensions(
		vscode.workspace.getConfiguration(SECTION, scope).get<unknown>('allowedBoundingBoxFileExtensions'),
	);
}

export function getBboxUriForImage(
	workspaceFolder: vscode.WorkspaceFolder,
	imageUri: vscode.Uri,
	scope?: vscode.ConfigurationScope,
): vscode.Uri {
	const bboxDirSetting = (vscode.workspace.getConfiguration(SECTION, scope).get<string>('bboxDirectory') ?? '').trim();
	const base = imageUri.path.replace(/\.[^/.]+$/, '');
	const baseName = base.split('/').pop() ?? '';
	const ext = getBboxExtension(scope);
	if (!bboxDirSetting) {
		const imageDir = path.dirname(imageUri.fsPath);
		return vscode.Uri.joinPath(vscode.Uri.file(imageDir), baseName + ext);
	}
	const bboxDir = getBboxDirUri(workspaceFolder, scope);
	return vscode.Uri.joinPath(bboxDir, baseName + ext);
}

function getBboxDirOrImageDirUri(
	workspaceFolder: vscode.WorkspaceFolder,
	imageUri: vscode.Uri,
	scope?: vscode.ConfigurationScope,
): vscode.Uri {
	const config = vscode.workspace.getConfiguration(SECTION, scope);
	const bboxDirSetting = (config.get<string>('bboxDirectory') ?? '').trim();
	if (!bboxDirSetting) {
		return vscode.Uri.file(path.dirname(imageUri.fsPath));
	}
	return getBboxDirUri(workspaceFolder, scope);
}

export async function getBboxCandidateUris(
	workspaceFolder: vscode.WorkspaceFolder,
	imageUri: vscode.Uri,
	scope?: vscode.ConfigurationScope,
): Promise<vscode.Uri[]> {
	const dirUri = getBboxDirOrImageDirUri(workspaceFolder, imageUri, scope);
	const base = imageUri.path.replace(/\.[^/.]+$/, '');
	const baseName = base.split('/').pop() ?? '';
	const allowed = getAllowedBoundingBoxFileExtensions(scope);
	const acceptAny = allowed.length === 0 || allowed.includes('*');

	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dirUri);
	} catch {
		return [];
	}

	const candidateUris: vscode.Uri[] = [];
	for (const [name, fileType] of entries) {
		if (fileType !== vscode.FileType.File) {
			continue;
		}
		if (!name.startsWith(baseName) || name.length <= baseName.length) {
			continue;
		}
		const ext = name.slice(baseName.length);
		if (acceptAny) {
			candidateUris.push(vscode.Uri.joinPath(dirUri, name));
		} else if (allowed.includes(ext)) {
			candidateUris.push(vscode.Uri.joinPath(dirUri, name));
		}
	}
	candidateUris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
	return candidateUris;
}

export interface ReadMergedBboxResult {
	content: string;
	boxes: Bbox[];
	primaryUri: vscode.Uri;
}

export async function readMergedBboxContent(
	workspaceFolder: vscode.WorkspaceFolder,
	imageUri: vscode.Uri,
	scope?: vscode.ConfigurationScope,
): Promise<ReadMergedBboxResult> {
	const candidateUris = await getBboxCandidateUris(workspaceFolder, imageUri, scope);
	const settings = getSettings(scope);
	const readContents: { uri: vscode.Uri; content: string }[] = [];

	for (const uri of candidateUris) {
		try {
			const buf = await vscode.workspace.fs.readFile(uri);
			const content = new TextDecoder().decode(buf);
			readContents.push({ uri, content });
		} catch {
			// skip unreadable file
		}
	}

	const firstContent = readContents[0]?.content ?? null;
	const detected = firstContent ? detect(firstContent) : null;
	const provider = detected ?? getProvider(settings.bboxFormat) ?? getProvider('coco')!;
	setProviderForImage(imageUri, provider);

	const lines: string[] = [];
	const boxes: Bbox[] = [];
	for (const { content } of readContents) {
		lines.push(content.trim());
		boxes.push(...provider.parse(content, 0, 0));
	}

	const primaryUri = readContents[0]?.uri ?? getBboxUriForImage(workspaceFolder, imageUri, scope);
	const content = lines.filter(Boolean).join('\n');
	return { content, boxes, primaryUri };
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
