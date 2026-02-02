import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	ProjectTreeDataProvider,
	ProjectTreeItem,
	BoundingBoxesGroupItem,
	BoxTreeItem,
} from '../explorer';

suite('explorer', () => {
	const provider = new ProjectTreeDataProvider();

	test('getChildren(undefined) returns array of ProjectTreeItem when workspace has folders', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const children = await provider.getChildren(undefined);
		assert.ok(Array.isArray(children));
		children.forEach((el) => assert.ok(el instanceof ProjectTreeItem, 'each root child is ProjectTreeItem'));
	});

	test('getChildren(ProjectTreeItem with bboxUri) returns single BoundingBoxesGroupItem', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'test-image.png');
		const bboxUri = vscode.Uri.joinPath(folder.uri, 'test-image.txt');
		const imageItem = new ProjectTreeItem(imageUri, bboxUri, folder);
		const children = await provider.getChildren(imageItem);
		assert.strictEqual(children.length, 1, 'one child');
		assert.ok(children[0] instanceof BoundingBoxesGroupItem, 'child is BoundingBoxesGroupItem');
		assert.strictEqual((children[0] as BoundingBoxesGroupItem).label, 'Bounding boxes');
	});

	test('getChildren(BoundingBoxesGroupItem with non-existent bbox file) returns empty array', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'nonexistent-image.png');
		const bboxUri = vscode.Uri.joinPath(folder.uri, 'nonexistent-image.txt');
		const groupItem = new BoundingBoxesGroupItem(imageUri, bboxUri, folder);
		const children = await provider.getChildren(groupItem);
		assert.ok(Array.isArray(children));
		assert.strictEqual(children.length, 0, 'no box children when bbox file does not exist');
	});

	test('getTreeItem returns the same element', () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'x.png');
		const item = new ProjectTreeItem(imageUri, undefined, folder);
		const treeItem = provider.getTreeItem(item);
		assert.strictEqual(treeItem, item);
	});

	test('ProjectTreeItem with bboxUri is collapsible', () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'a.png');
		const bboxUri = vscode.Uri.joinPath(folder.uri, 'a.txt');
		const item = new ProjectTreeItem(imageUri, bboxUri, folder);
		assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
	});

	test('BoxTreeItem has openImageWithBox command and arguments', () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'b.png');
		const item = new BoxTreeItem(imageUri, 0, 'Box 1');
		assert.ok(item.command);
		assert.strictEqual(item.command?.command, 'bounding-box-editor.openImageWithBox');
		assert.deepStrictEqual(item.command?.arguments, [imageUri, 0]);
	});

	test('BoxTreeItem accepts optional description and selected', () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'b.png');
		const withDesc = new BoxTreeItem(imageUri, 0, 'Label', { description: 'x:10 y:20 w:30 h:40' });
		assert.strictEqual(withDesc.description, 'x:10 y:20 w:30 h:40');
		const withSelected = new BoxTreeItem(imageUri, 0, 'Label', { description: 'coords', selected: true });
		assert.ok((withSelected.description as string).includes('(selected)'));
	});

	test('getChildren(BoundingBoxesGroupItem) returns BoxTreeItems when bbox file exists with COCO content', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const base = `test-explorer-${Date.now()}`;
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		const bboxUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		try {
			await vscode.workspace.fs.writeFile(
				bboxUri,
				new TextEncoder().encode('10 20 30 40 label1\n50 60 70 80 label2\n'),
			);
			const groupItem = new BoundingBoxesGroupItem(imageUri, bboxUri, folder);
			const children = await provider.getChildren(groupItem);
			assert.strictEqual(children.length, 2);
			assert.ok(children[0] instanceof BoxTreeItem);
			assert.ok(children[1] instanceof BoxTreeItem);
			assert.strictEqual((children[0] as BoxTreeItem).label, 'label1');
			assert.strictEqual((children[1] as BoxTreeItem).label, 'label2');
		} finally {
			try {
				await vscode.workspace.fs.delete(bboxUri);
			} catch {
				// ignore
			}
		}
	});

	test('getChildren(BoundingBoxesGroupItem) shows YOLO box labels when getDimensions provided', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const base = `test-explorer-yolo-${Date.now()}`;
		const imageUri = vscode.Uri.joinPath(folder.uri, `${base}.png`);
		const bboxUri = vscode.Uri.joinPath(folder.uri, `${base}.txt`);
		const config = vscode.workspace.getConfiguration('boundingBoxEditor');
		await config.update('bboxFormat', 'yolo', vscode.ConfigurationTarget.Global);
		const providerWithDimensions = new ProjectTreeDataProvider({
			getDimensions: () => ({ width: 100, height: 100 }),
		});
		try {
			await vscode.workspace.fs.writeFile(
				bboxUri,
				new TextEncoder().encode('person 0.5 0.5 0.2 0.2\ncar 0.25 0.25 0.1 0.1\n'),
			);
			const groupItem = new BoundingBoxesGroupItem(imageUri, bboxUri, folder);
			const children = await providerWithDimensions.getChildren(groupItem);
			assert.strictEqual(children.length, 2);
			assert.ok(children[0] instanceof BoxTreeItem);
			assert.ok(children[1] instanceof BoxTreeItem);
			assert.strictEqual((children[0] as BoxTreeItem).label, 'person');
			assert.strictEqual((children[1] as BoxTreeItem).label, 'car');
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
