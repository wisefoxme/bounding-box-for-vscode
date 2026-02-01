import * as assert from 'assert';
import * as vscode from 'vscode';
import { getSettings, getImageDirUri, getBboxDirUri, getBboxExtension, getBboxUriForImage } from '../settings';

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
});
