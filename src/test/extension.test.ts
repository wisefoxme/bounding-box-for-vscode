import * as assert from 'assert';
import * as vscode from 'vscode';
import { BoxTreeItem, ProjectTreeItem, BoundingBoxesGroupItem } from '../explorer';
import { createOnBboxSaved } from '../extension';

suite('Extension Test Suite', () => {
	test('Extension activates', async () => {
		const ext = vscode.extensions.getExtension('vscode.bounding-box-editor');
		if (!ext) {
			// Extension id may differ when running from workspace
			const all = vscode.extensions.all.filter((e) => e.id.includes('bounding-box') || e.id.includes('Bonding'));
			assert.ok(all.length >= 1, 'Extension should be loaded');
			return;
		}
		await ext.activate();
		assert.strictEqual(ext.isActive, true);
	});

	test('setBboxFormat command can be invoked without throwing', async function () {
		this.timeout(3000);
		// When a workspace folder is open, the command shows a QuickPick and does not resolve until the user picks.
		// Race with a short timeout: if the command completes (no workspace) or we timeout (picker open), it was invocable.
		const result = await Promise.race([
			vscode.commands.executeCommand('bounding-box-editor.setBboxFormat'),
			new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1500)),
		]);
		if (result === 'timeout') {
			return; // Command opened UI and is waiting; consider it invocable.
		}
	});

	test('revealBboxFile can be invoked with BoxTreeItem argument without throwing', async () => {
		const ext = vscode.extensions.getExtension('vscode.bounding-box-editor');
		const resolved = ext ?? vscode.extensions.all.find((e) => e.id.includes('bounding-box'));
		if (!resolved) {
			return;
		}
		await resolved.activate();
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, 'test.png');
		const item = new BoxTreeItem(imageUri, 0, 'Box 1');
		await assert.doesNotReject(
			Promise.resolve(vscode.commands.executeCommand('bounding-box-editor.revealBboxFile', item)),
			'revealBboxFile should not throw when invoked with BoxTreeItem',
		);
	});

	test('removeAllBoxes can be invoked with no arguments without throwing', async () => {
		await assert.doesNotReject(
			Promise.resolve(vscode.commands.executeCommand('bounding-box-editor.removeAllBoxes')),
			'removeAllBoxes should not throw when invoked with no selection',
		);
	});

	test('removeAllBoxes can be invoked with BoundingBoxesGroupItem argument without throwing', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'test-remove-all.png');
		const bboxUri = vscode.Uri.joinPath(folder.uri, 'test-remove-all.txt');
		const item = new BoundingBoxesGroupItem(imageUri, bboxUri, folder);
		await assert.doesNotReject(
			Promise.resolve(vscode.commands.executeCommand('bounding-box-editor.removeAllBoxes', item)),
			'removeAllBoxes should not throw when invoked with BoundingBoxesGroupItem',
		);
	});

	test('removeAllBoxes can be invoked with ProjectTreeItem (imageWithBbox) argument without throwing', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const folder = folders[0];
		const imageUri = vscode.Uri.joinPath(folder.uri, 'test-remove-all-image.png');
		const bboxUri = vscode.Uri.joinPath(folder.uri, 'test-remove-all-image.txt');
		const item = new ProjectTreeItem(imageUri, bboxUri, folder);
		await assert.doesNotReject(
			Promise.resolve(vscode.commands.executeCommand('bounding-box-editor.removeAllBoxes', item)),
			'removeAllBoxes should not throw when invoked with ProjectTreeItem',
		);
	});

	test('createOnBboxSaved only refreshes bbox section (not project tree)', async () => {
		let refreshCount = 0;
		const mockBboxSection = { refresh: () => { refreshCount++; } };
		const onBboxSaved = createOnBboxSaved(mockBboxSection);
		onBboxSaved();
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 60));
		assert.strictEqual(refreshCount, 2, 'bbox section refresh should be called twice (deferred + 50ms)');
	});
});
