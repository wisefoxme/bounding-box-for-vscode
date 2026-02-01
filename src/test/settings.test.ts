import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	getSettings,
	getImageDirUri,
	getBboxDirUri,
	getBboxExtension,
	getAllowedBoundingBoxFileExtensions,
	getBboxUriForImage,
	getBboxCandidateUris,
	getDefaultBoundingBoxes,
} from '../settings';

suite('settings', () => {
	test('getSettings returns defaults when no config', () => {
		const s = getSettings();
		assert.strictEqual(typeof s.imageDirectory, 'string');
		assert.strictEqual(typeof s.bboxDirectory, 'string');
		assert.ok(['coco', 'yolo', 'pascal_voc'].includes(s.bboxFormat));
		assert.ok(Array.isArray(s.allowedBoundingBoxFileExtensions));
	});
	test('getBboxExtension returns .txt', () => {
		assert.strictEqual(getBboxExtension(), '.txt');
	});
	test('getAllowedBoundingBoxFileExtensions returns [".txt"] by default', () => {
		const result = getAllowedBoundingBoxFileExtensions();
		assert.deepStrictEqual(result, ['.txt']);
	});
	test('getAllowedBoundingBoxFileExtensions normalizes "box" to ".box"', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('allowedBoundingBoxFileExtensions', ['box', '.txt'], vscode.ConfigurationTarget.Global);
		try {
			const result = getAllowedBoundingBoxFileExtensions();
			assert.deepStrictEqual(result, ['.box', '.txt']);
		} finally {
			await config.update('allowedBoundingBoxFileExtensions', undefined, vscode.ConfigurationTarget.Global);
		}
	});
	test('getAllowedBoundingBoxFileExtensions returns empty array when config is []', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('allowedBoundingBoxFileExtensions', [], vscode.ConfigurationTarget.Global);
		try {
			const result = getAllowedBoundingBoxFileExtensions();
			assert.deepStrictEqual(result, []);
		} finally {
			await config.update('allowedBoundingBoxFileExtensions', undefined, vscode.ConfigurationTarget.Global);
		}
	});
	test('getAllowedBoundingBoxFileExtensions preserves "*"', async () => {
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('allowedBoundingBoxFileExtensions', ['*', '.txt'], vscode.ConfigurationTarget.Global);
		try {
			const result = getAllowedBoundingBoxFileExtensions();
			assert.deepStrictEqual(result, ['*', '.txt']);
		} finally {
			await config.update('allowedBoundingBoxFileExtensions', undefined, vscode.ConfigurationTarget.Global);
		}
	});
	test('getBboxCandidateUris returns matching .txt file when allowed is [".txt"]', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('allowedBoundingBoxFileExtensions', ['.txt'], vscode.ConfigurationTarget.Global);
		const base = `test-candidate-${Date.now()}`;
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		const bboxUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		try {
			await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode('0 0 10 10'));
			const candidates = await getBboxCandidateUris(folder, imageUri);
			assert.strictEqual(candidates.length, 1);
			assert.strictEqual(candidates[0].toString(), bboxUri.toString());
		} finally {
			await config.update('allowedBoundingBoxFileExtensions', undefined, vscode.ConfigurationTarget.Global);
			try {
				await vscode.workspace.fs.delete(bboxUri);
			} catch {
				// ignore
			}
		}
	});
	test('getBboxCandidateUris returns empty when no matching file and allowed [".txt"]', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folder.uri, `nonexistent-${Date.now()}.png`);
		const candidates = await getBboxCandidateUris(folder, imageUri);
		assert.strictEqual(candidates.length, 0);
	});
	test('getBboxCandidateUris returns only .txt when [".txt"] and both .txt and .box exist', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('allowedBoundingBoxFileExtensions', ['.txt'], vscode.ConfigurationTarget.Global);
		const base = `test-txt-only-${Date.now()}`;
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		const txtUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		const boxUri = vscode.Uri.joinPath(folder.uri, `${base}.box`);
		try {
			await vscode.workspace.fs.writeFile(txtUri, new TextEncoder().encode('0 0 10 10'));
			await vscode.workspace.fs.writeFile(boxUri, new TextEncoder().encode('0 0 20 20'));
			const candidates = await getBboxCandidateUris(folder, imageUri);
			assert.strictEqual(candidates.length, 1);
			assert.ok(candidates[0].fsPath.endsWith('.txt'));
		} finally {
			await config.update('allowedBoundingBoxFileExtensions', undefined, vscode.ConfigurationTarget.Global);
			try {
				await vscode.workspace.fs.delete(txtUri);
				await vscode.workspace.fs.delete(boxUri);
			} catch {
				// ignore
			}
		}
	});
	test('getBboxCandidateUris returns both .txt and .box when allowed [".txt", ".box"]', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('allowedBoundingBoxFileExtensions', ['.txt', '.box'], vscode.ConfigurationTarget.Global);
		const base = `test-both-ext-${Date.now()}`;
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		const txtUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		const boxUri = vscode.Uri.joinPath(folder.uri, `${base}.box`);
		try {
			await vscode.workspace.fs.writeFile(txtUri, new TextEncoder().encode('0 0 10 10'));
			await vscode.workspace.fs.writeFile(boxUri, new TextEncoder().encode('0 0 20 20'));
			const candidates = await getBboxCandidateUris(folder, imageUri);
			assert.strictEqual(candidates.length, 2);
			const exts = candidates.map((u) => u.fsPath.replace(/.*\./, '.'));
			assert.ok(exts.includes('.txt'));
			assert.ok(exts.includes('.box'));
		} finally {
			await config.update('allowedBoundingBoxFileExtensions', undefined, vscode.ConfigurationTarget.Global);
			try {
				await vscode.workspace.fs.delete(txtUri);
				await vscode.workspace.fs.delete(boxUri);
			} catch {
				// ignore
			}
		}
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
