import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	getSettings,
	getImageDirUri,
	getBboxDirUri,
	getBboxExtension,
	getBboxUriForImage,
	getDefaultBoundingBoxes,
} from '../settings';

suite('settings', () => {
	test('getSettings returns defaults when no config', () => {
		const s = getSettings();
		assert.strictEqual(typeof s.imageDirectory, 'string');
		assert.strictEqual(typeof s.bboxDirectory, 'string');
		assert.ok(['coco', 'yolo', 'pascal_voc'].includes(s.bboxFormat));
	});
	test('getBboxExtension returns .txt', () => {
		assert.strictEqual(getBboxExtension(), '.txt');
	});
	test('getImageDirUri and getBboxDirUri with workspace folder', () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const imageUri = getImageDirUri(folder);
		const bboxUri = getBboxDirUri(folder);
		assert.ok(imageUri instanceof vscode.Uri);
		assert.ok(bboxUri instanceof vscode.Uri);
		assert.ok(folder.uri.fsPath.length > 0);
	});
	test('getBboxUriForImage returns bbox path for image in folder', () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folder.uri, 'sub', 'photo.png');
		const bboxUri = getBboxUriForImage(folder, imageUri);
		assert.ok(bboxUri.fsPath.endsWith('.txt'));
		assert.ok(bboxUri.fsPath.includes('photo'));
	});

	test('getBboxUriForImage returns path next to image when bboxDirectory not set', () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folder.uri, 'sub', 'photo.png');
		const bboxUri = getBboxUriForImage(folder, imageUri);
		const imageDir = imageUri.fsPath.replace(/\/[^/]+$/, '');
		const bboxDir = bboxUri.fsPath.replace(/\/[^/]+$/, '');
		assert.strictEqual(bboxDir, imageDir, 'bbox file should be in same directory as image when bboxDirectory is empty');
	});

	test('getDefaultBoundingBoxes returns empty when no config or empty array', () => {
		const result = getDefaultBoundingBoxes();
		assert.ok(Array.isArray(result));
		assert.strictEqual(result.length, 0);
	});

	test('getDefaultBoundingBoxes returns empty for invalid entries', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('defaultBoundingBoxes', [{ x: 0, y: 0, w: -1, h: 10 }], vscode.ConfigurationTarget.Global);
		try {
			const result = getDefaultBoundingBoxes();
			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 0);
		} finally {
			await config.update('defaultBoundingBoxes', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('getDefaultBoundingBoxes returns empty for non-array config', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('defaultBoundingBoxes', { x: 0, y: 0, w: 10, h: 10 }, vscode.ConfigurationTarget.Global);
		try {
			const result = getDefaultBoundingBoxes();
			assert.strictEqual(result.length, 0);
		} finally {
			await config.update('defaultBoundingBoxes', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('getDefaultBoundingBoxes returns Bbox[] for valid entries', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update(
			'defaultBoundingBoxes',
			[
				{ x: 10, y: 20, w: 30, h: 40 },
				{ x: 0, y: 0, w: 5, h: 5, label: 'tiny' },
			],
			vscode.ConfigurationTarget.Global,
		);
		try {
			const result = getDefaultBoundingBoxes();
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].x_min, 10);
			assert.strictEqual(result[0].y_min, 20);
			assert.strictEqual(result[0].width, 30);
			assert.strictEqual(result[0].height, 40);
			assert.strictEqual(result[1].x_min, 0);
			assert.strictEqual(result[1].y_min, 0);
			assert.strictEqual(result[1].width, 5);
			assert.strictEqual(result[1].height, 5);
			assert.strictEqual(result[1].label, 'tiny');
		} finally {
			await config.update('defaultBoundingBoxes', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('getDefaultBoundingBoxes returns empty when any entry has w or h <= 0', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update(
			'defaultBoundingBoxes',
			[
				{ x: 0, y: 0, w: 10, h: 10 },
				{ x: 0, y: 0, w: 0, h: 10 },
			],
			vscode.ConfigurationTarget.Global,
		);
		try {
			const result = getDefaultBoundingBoxes();
			assert.strictEqual(result.length, 0);
		} finally {
			await config.update('defaultBoundingBoxes', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
