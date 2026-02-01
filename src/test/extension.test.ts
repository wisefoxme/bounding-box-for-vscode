import * as assert from 'assert';
import * as vscode from 'vscode';

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
});
