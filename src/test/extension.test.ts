import * as assert from 'assert';
import * as vscode from 'vscode';
import { BoxTreeItem } from '../explorer';

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
});
