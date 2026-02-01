import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	BboxSectionTreeDataProvider,
	CreateNewBoxItem,
	BboxSectionPlaceholderItem,
} from '../bboxSection';
import { setSelectedImageUri, getSelectedImageUri } from '../selectedImage';

suite('selectedImage', () => {
	test('getSelectedImageUri returns undefined initially', () => {
		setSelectedImageUri(undefined);
		assert.strictEqual(getSelectedImageUri(), undefined);
	});

	test('setSelectedImageUri and getSelectedImageUri round-trip', () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const uri = vscode.Uri.joinPath(folders[0].uri, 'test.png');
		setSelectedImageUri(uri);
		assert.strictEqual(getSelectedImageUri()?.toString(), uri.toString());
		setSelectedImageUri(undefined);
		assert.strictEqual(getSelectedImageUri(), undefined);
	});
});

suite('bboxSection', () => {
	const provider = new BboxSectionTreeDataProvider();

	test('getChildren(undefined) returns placeholder when no image selected', async () => {
		setSelectedImageUri(undefined);
		const children = await provider.getChildren(undefined);
		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof BboxSectionPlaceholderItem);
		assert.strictEqual((children[0] as BboxSectionPlaceholderItem).label, 'Select an image from Project');
	});

	test('getChildren(undefined) returns only CreateNewBoxItem when image selected but no bbox file', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, 'no-bbox-file.png');
		setSelectedImageUri(imageUri);
		const children = await provider.getChildren(undefined);
		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof CreateNewBoxItem);
		assert.strictEqual((children[0] as CreateNewBoxItem).label, 'Create new bounding box');
		setSelectedImageUri(undefined);
	});

	test('getChildren(undefined) returns CreateNewBoxItem plus box items when image has bbox file', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const base = `test-bbox-section-${Date.now()}`;
		const bboxUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		try {
			await vscode.workspace.fs.writeFile(
				bboxUri,
				new TextEncoder().encode('10 20 30 40 label1\n50 60 70 80 label2\n'),
			);
			setSelectedImageUri(imageUri);
			const children = await provider.getChildren(undefined);
			assert.ok(children.length >= 3, 'CreateNewBoxItem + 2 box items');
			assert.ok(children[0] instanceof CreateNewBoxItem);
			assert.strictEqual((children[0] as CreateNewBoxItem).label, 'Create new bounding box');
			setSelectedImageUri(undefined);
		} finally {
			try {
				await vscode.workspace.fs.delete(bboxUri);
			} catch {
				// ignore
			}
		}
	});

	test('CreateNewBoxItem has createNewBbox command and add icon', () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, 'x.png');
		const item = new CreateNewBoxItem(imageUri);
		assert.strictEqual(item.contextValue, 'createBbox');
		assert.ok(item.command);
		assert.strictEqual(item.command?.command, 'bounding-box-editor.createNewBbox');
		assert.deepStrictEqual(item.command?.arguments, [imageUri]);
	});
});
