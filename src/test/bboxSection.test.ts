import * as assert from 'assert';
import * as vscode from 'vscode';
import type { Bbox } from '../bbox';
import { BboxSectionTreeDataProvider, BboxSectionPlaceholderItem } from '../bboxSection';
import { BoxTreeItem } from '../explorer';
import {
	setSelectedImageUri,
	getSelectedImageUri,
	setSelectedBoxIndex,
	getSelectedBoxIndex,
	setSelectedBoxIndices,
	getSelectedBoxIndices,
} from '../selectedImage';

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

	test('getSelectedBoxIndex returns undefined initially', () => {
		setSelectedBoxIndex(undefined);
		assert.strictEqual(getSelectedBoxIndex(), undefined);
	});

	test('setSelectedBoxIndex and getSelectedBoxIndex round-trip', () => {
		setSelectedBoxIndex(0);
		assert.strictEqual(getSelectedBoxIndex(), 0);
		setSelectedBoxIndex(2);
		assert.strictEqual(getSelectedBoxIndex(), 2);
		setSelectedBoxIndex(undefined);
		assert.strictEqual(getSelectedBoxIndex(), undefined);
	});

	test('getSelectedBoxIndices and setSelectedBoxIndices round-trip', () => {
		setSelectedBoxIndices([]);
		assert.deepStrictEqual(getSelectedBoxIndices(), []);
		setSelectedBoxIndices([0, 2]);
		assert.deepStrictEqual(getSelectedBoxIndices(), [0, 2]);
		setSelectedBoxIndices([1]);
		assert.strictEqual(getSelectedBoxIndex(), 1);
	});
});

suite('bboxSection', () => {
	const provider = new BboxSectionTreeDataProvider();
	const providerWithDimensions = new BboxSectionTreeDataProvider({
		getDimensions: () => ({ width: 100, height: 100 }),
	});

	test('getChildren(undefined) returns placeholder when no image selected', async () => {
		setSelectedImageUri(undefined);
		const children = await provider.getChildren(undefined);
		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof BboxSectionPlaceholderItem);
		assert.strictEqual((children[0] as BboxSectionPlaceholderItem).label, 'Select an image from Project');
	});

	test('getChildren(undefined) returns no-boxes placeholder when image selected but no bbox file', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, 'no-bbox-file.png');
		setSelectedImageUri(imageUri);
		const children = await provider.getChildren(undefined);
		assert.strictEqual(children.length, 1);
		assert.ok(children[0] instanceof BboxSectionPlaceholderItem);
		assert.strictEqual(
			(children[0] as BboxSectionPlaceholderItem).label,
			'Open the image and draw on the canvas to add boxes',
		);
		setSelectedImageUri(undefined);
	});

	test('getChildren(undefined) returns only box items when image has bbox file', async () => {
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
			assert.strictEqual(children.length, 2, '2 box items');
			assert.ok(children[0] instanceof BoxTreeItem);
			assert.ok(children[1] instanceof BoxTreeItem);
			assert.strictEqual((children[0] as BoxTreeItem).label, 'label1');
			assert.strictEqual((children[1] as BoxTreeItem).label, 'label2');
			setSelectedImageUri(undefined);
		} finally {
			try {
				await vscode.workspace.fs.delete(bboxUri);
			} catch {
				// ignore
			}
		}
	});

	test('getChildren(undefined) uses getLiveBoxes when it returns an array', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, 'live-boxes-test.png');
		const liveBoxes: Bbox[] = [
			{ x_min: 0, y_min: 0, width: 10, height: 10, label: 'live1' },
			{ x_min: 20, y_min: 20, width: 30, height: 30, label: 'live2' },
		];
		const providerWithLive = new BboxSectionTreeDataProvider({
			getLiveBoxes: (uri) => (uri.toString() === imageUri.toString() ? liveBoxes : undefined),
		});
		setSelectedImageUri(imageUri);
		const children = await providerWithLive.getChildren(undefined);
		setSelectedImageUri(undefined);
		assert.strictEqual(children.length, 2, 'should use live boxes');
		assert.ok(children[0] instanceof BoxTreeItem);
		assert.ok(children[1] instanceof BoxTreeItem);
		assert.strictEqual((children[0] as BoxTreeItem).label, 'live1');
		assert.strictEqual((children[1] as BoxTreeItem).label, 'live2');
	});

	test('getChildren(undefined) shows YOLO box labels when getDimensions provided', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const base = `test-bbox-section-yolo-${Date.now()}`;
		const bboxUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('bboxFormat', 'yolo', vscode.ConfigurationTarget.Global);
		try {
			await vscode.workspace.fs.writeFile(
				bboxUri,
				new TextEncoder().encode('person 0.5 0.5 0.2 0.2\ncar 0.25 0.25 0.1 0.1\n'),
			);
			setSelectedImageUri(imageUri);
			const children = await providerWithDimensions.getChildren(undefined);
			assert.strictEqual(children.length, 2, '2 box items');
			assert.ok(children[0] instanceof BoxTreeItem);
			assert.ok(children[1] instanceof BoxTreeItem);
			assert.strictEqual((children[0] as BoxTreeItem).label, 'person');
			assert.strictEqual((children[1] as BoxTreeItem).label, 'car');
			setSelectedImageUri(undefined);
		} finally {
			await config.update('bboxFormat', undefined, vscode.ConfigurationTarget.Global);
			try {
				await vscode.workspace.fs.delete(bboxUri);
			} catch {
				// ignore
			}
		}
	});
});
