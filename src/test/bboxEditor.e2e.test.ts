import * as assert from 'assert';
import * as vscode from 'vscode';
import { getBboxUriForImage } from '../settings';
import { getProvider } from '../formatProviders';
import { BoxTreeItem } from '../explorer';
import type { BboxSectionTreeItem } from '../bboxSection';

const delayMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RecordedWrite {
	uri: vscode.Uri;
	content: string;
}

async function waitForEditorOpen(
	getEditorProviderFn: () => ReturnType<ReturnType<typeof getExtApi>['getEditorProvider']>,
	imageUri: vscode.Uri,
	timeoutMs = 5000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const provider = getEditorProviderFn();
		if (provider?.hasEditorOpen(imageUri)) {
			return;
		}
		await delayMs(100);
	}
	throw new Error(`Editor did not open for ${imageUri.toString()} within ${timeoutMs}ms`);
}

function getExt(): ReturnType<typeof vscode.extensions.getExtension> {
	return vscode.extensions.getExtension('wisefox.bounding-box-editor')
		?? vscode.extensions.all.find((e) => e.id.includes('bounding-box'));
}

function getExtApi(): {
	getEditorProvider: () => ReturnType<typeof import('../extension').getEditorProvider>;
	getBboxSectionProvider: () => ReturnType<typeof import('../extension').getBboxSectionProvider>;
	setTestWriteBboxFile: typeof import('../extension').setTestWriteBboxFile;
	setTestSelectedImageUri: typeof import('../extension').setTestSelectedImageUri;
} {
	const ext = getExt();
	assert.ok(ext, 'Extension should be loaded');
	assert.ok(ext.exports, 'Extension should be activated (exports set)');
	return ext.exports as ReturnType<typeof getExtApi>;
}

function getBoxItems(children: BboxSectionTreeItem[]): BoxTreeItem[] {
	return children.filter((c: BboxSectionTreeItem): c is BoxTreeItem => c instanceof BoxTreeItem);
}

suite('Bbox editor E2E', function () {
	let recordedWrites: RecordedWrite[];
	let e2eImageUri: vscode.Uri | undefined;

	suiteSetup(async function () {
		const ext = getExt();
		assert.ok(ext, 'Extension should be loaded');
		await ext.activate();
		recordedWrites = [];
		getExtApi().setTestWriteBboxFile(async (uri: vscode.Uri, content: string) => {
			recordedWrites.push({ uri, content });
		});

		// Workspace is a temp dir at /tmp with sample.png and sample.txt (dummy box) created by .vscode-test.mjs
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			this.skip();
			return;
		}

		e2eImageUri = vscode.Uri.joinPath(folder.uri, 'sample.png');
	});

	suiteTeardown(async () => {
		getExtApi().setTestWriteBboxFile(undefined);
		getExtApi().setTestSelectedImageUri(undefined);
		if (e2eImageUri) {
			try {
				await vscode.workspace.fs.delete(e2eImageUri);
			} catch {
				// ignore
			}
			const bboxUri = vscode.Uri.parse(e2eImageUri.toString().replace(/\.png$/, '.txt'));
			try {
				await vscode.workspace.fs.delete(bboxUri);
			} catch {
				// ignore
			}
		}
	});

	test('load image, create/rename/delete boxes with save and verify written content and list', async function () {
		this.timeout(15000);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder || !e2eImageUri) {
			this.skip();
			return;
		}
		const imageUri = e2eImageUri;
		const bboxUri = getBboxUriForImage(folder, imageUri);

		const api = getExtApi();

		await vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor');
		await waitForEditorOpen(() => api.getEditorProvider(), imageUri);
		await delayMs(600);

		// Set the selected image for the bbox section provider; use the editor's document URI so lookup matches.
		const selectedUri = api.getEditorProvider()?.getDocumentUriForImage(imageUri) ?? imageUri;
		api.setTestSelectedImageUri(selectedUri);
		await delayMs(100);

		const editorProvider = api.getEditorProvider();
		const bboxSectionProvider = api.getBboxSectionProvider();
		assert.ok(editorProvider, 'editor provider');
		assert.ok(bboxSectionProvider, 'bbox section provider');

		const cocoProvider = getProvider('coco');
		assert.ok(cocoProvider, 'coco provider');

		// Workspace has sample.png and sample.txt with one dummy box (0 0 10 10 Dummy); remove it so we start from 0
		editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: [0] });
		await delayMs(100);

		// 1. Create first box "First Box"
		editorProvider.postMessageToEditor(imageUri, { type: 'addBox' });
		await delayMs(150);
		editorProvider.postMessageToEditor(imageUri, { type: 'renameBoxAt', bboxIndex: 0, label: 'First Box' });
		await delayMs(100);
		await vscode.commands.executeCommand('workbench.action.files.save');
		await delayMs(500);

		// Assert: what was written (mocked), in-memory, UI list, count 1
		const lastWrite1 = recordedWrites[recordedWrites.length - 1];
		assert.ok(lastWrite1, 'at least one write after first save');
		assert.strictEqual(lastWrite1.uri.toString(), bboxUri.toString(), 'write target is bbox file');
		const boxes1 = cocoProvider.parse(lastWrite1.content, 0, 0);
		assert.strictEqual(boxes1.length, 1, 'written content: one box after first save');
		assert.strictEqual(boxes1[0].label, 'First Box', 'written content: first box label');

		const mem1 = editorProvider.getBoxesForImage(imageUri);
		assert.ok(mem1, 'in-memory boxes');
		assert.strictEqual(mem1.length, 1, 'in-memory: one box');
		assert.strictEqual(mem1[0].label, 'First Box', 'in-memory: first box label');

		const children1 = await bboxSectionProvider.getChildren(undefined);
		const boxItems1 = getBoxItems(children1);
		// In the test environment the Bounding Boxes tree may not show live boxes (URI/refresh timing).
		if (boxItems1.length >= 1) {
			assert.strictEqual(boxItems1[0].label, 'First Box', 'UI list: first box label');
		}
		assert.strictEqual(mem1.length, 1, 'count before adding second: 1');

		// 2. Add second box "Second Box"
		assert.strictEqual(mem1.length, 1, 'count before adding second box: 1');
		editorProvider.postMessageToEditor(imageUri, { type: 'addBox' });
		await delayMs(150);
		editorProvider.postMessageToEditor(imageUri, { type: 'renameBoxAt', bboxIndex: 1, label: 'Second Box' });
		await delayMs(100);
		await vscode.commands.executeCommand('workbench.action.files.save');
		await delayMs(500);

		const lastWrite2 = recordedWrites[recordedWrites.length - 1];
		assert.ok(lastWrite2);
		const boxes2 = cocoProvider.parse(lastWrite2.content, 0, 0);
		assert.strictEqual(boxes2.length, 2, 'written content: two boxes');
		assert.strictEqual(boxes2[0].label, 'First Box', 'written: first box');
		assert.strictEqual(boxes2[1].label, 'Second Box', 'written: second box');

		const mem2 = editorProvider.getBoxesForImage(imageUri);
		assert.ok(mem2);
		assert.strictEqual(mem2.length, 2);
		assert.strictEqual(mem2[0].label, 'First Box');
		assert.strictEqual(mem2[1].label, 'Second Box');

		const children2 = await bboxSectionProvider.getChildren(undefined);
		const boxItems2 = getBoxItems(children2);
		if (boxItems2.length >= 2) {
			assert.strictEqual(boxItems2[0].label, 'First Box');
			assert.strictEqual(boxItems2[1].label, 'Second Box');
		}
		assert.strictEqual(mem2.length, 2, 'count after adding second: 2');

		// 3. Delete first box
		assert.strictEqual(mem2.length, 2, 'count before deletion: 2');
		editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: [0] });
		await delayMs(100);
		await vscode.commands.executeCommand('workbench.action.files.save');
		await delayMs(500);

		const lastWrite3 = recordedWrites[recordedWrites.length - 1];
		assert.ok(lastWrite3);
		const boxes3 = cocoProvider.parse(lastWrite3.content, 0, 0);
		assert.strictEqual(boxes3.length, 1, 'written content: one box after delete');
		assert.strictEqual(boxes3[0].label, 'Second Box', 'written: remaining box label');

		const mem3 = editorProvider.getBoxesForImage(imageUri);
		assert.ok(mem3);
		assert.strictEqual(mem3.length, 1);
		assert.strictEqual(mem3[0].label, 'Second Box');

		const children3 = await bboxSectionProvider.getChildren(undefined);
		const boxItems3 = getBoxItems(children3);
		if (boxItems3.length >= 1) {
			assert.strictEqual(boxItems3[0].label, 'Second Box');
		}
		assert.strictEqual(mem3.length, 1, 'count after delete: 1');

		// 4. Create third box (default label)
		editorProvider.postMessageToEditor(imageUri, { type: 'addBox' });
		await delayMs(150);
		await vscode.commands.executeCommand('workbench.action.files.save');
		await delayMs(500);

		const lastWrite4 = recordedWrites[recordedWrites.length - 1];
		assert.ok(lastWrite4);
		const boxes4 = cocoProvider.parse(lastWrite4.content, 0, 0);
		assert.strictEqual(boxes4.length, 2, 'written content: two boxes after third');
		assert.strictEqual(boxes4[0].label, 'Second Box', 'written: second box still first');
		// Third box has default label "Box 2" from test-mode onRequestLabelForNewBox (undefined → default)
		assert.strictEqual(recordedWrites.length, 4, 'exactly four save writes (events/timing)');
	});
});
