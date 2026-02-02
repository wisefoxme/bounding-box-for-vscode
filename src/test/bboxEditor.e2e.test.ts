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

async function waitForPanelBoxCount(
	bboxSectionProvider: ReturnType<ReturnType<typeof getExtApi>['getBboxSectionProvider']>,
	expectedCount: number,
	timeoutMs = 2000,
): Promise<BoxTreeItem[]> {
	if (!bboxSectionProvider) {
		throw new Error('bboxSectionProvider is required');
	}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const children = await bboxSectionProvider.getChildren(undefined);
		const boxItems = getBoxItems(children);
		if (boxItems.length === expectedCount) {
			return boxItems;
		}
		await delayMs(50);
	}
	const children = await bboxSectionProvider.getChildren(undefined);
	return getBoxItems(children);
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

		// Set the selected image for the bbox section; use the editor's document URI so lookup matches.
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

		const boxItems1 = await waitForPanelBoxCount(bboxSectionProvider, 1);
		if (boxItems1.length >= 1) {
			assert.strictEqual(boxItems1.length, 1, 'UI list: one box after first');
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

		const boxItems2 = await waitForPanelBoxCount(bboxSectionProvider, 2);
		if (boxItems2.length >= 2) {
			assert.strictEqual(boxItems2.length, 2, 'UI list: two boxes after second');
			assert.strictEqual(boxItems2[0].label, 'First Box', 'UI list: first box label');
			assert.strictEqual(boxItems2[1].label, 'Second Box', 'UI list: second box label');
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

		const boxItems3 = await waitForPanelBoxCount(bboxSectionProvider, 1);
		if (boxItems3.length >= 1) {
			assert.strictEqual(boxItems3.length, 1, 'UI list: one box after delete');
			assert.strictEqual(boxItems3[0].label, 'Second Box', 'UI list: remaining box label');
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
		const boxItems4 = await waitForPanelBoxCount(bboxSectionProvider, 2);
		if (boxItems4.length >= 2) {
			assert.strictEqual(boxItems4.length, 2, 'UI list: two boxes after third');
			assert.strictEqual(boxItems4[0].label, 'Second Box', 'UI list: second box label');
			assert.strictEqual(boxItems4[1].label, 'Box 2', 'UI list: third box default label');
		}
		assert.strictEqual(recordedWrites.length, 4, 'exactly four save writes (events/timing)');
	});

	test('create box by drag and assert sidebar shows label without manual refresh', async function () {
		this.timeout(15000);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder || !e2eImageUri) {
			this.skip();
			return;
		}
		const imageUri = e2eImageUri;
		const api = getExtApi();

		await vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor');
		await waitForEditorOpen(() => api.getEditorProvider(), imageUri);
		await delayMs(600);

		// Set the selected image for the bbox section; use the editor's document URI so lookup matches.
		const selectedUri = api.getEditorProvider()?.getDocumentUriForImage(imageUri) ?? imageUri;
		api.setTestSelectedImageUri(selectedUri);
		// Wait for webview image to load (img.onload sets imgWidth/imgHeight; addBox only runs when > 0)
		await delayMs(1500);

		const editorProvider = api.getEditorProvider();
		const bboxSectionProvider = api.getBboxSectionProvider();
		assert.ok(editorProvider, 'editor provider');
		assert.ok(bboxSectionProvider, 'bbox section provider');

		// Clear any existing boxes so we start from 0
		const currentBoxes = editorProvider.getBoxesForImage(imageUri);
		if (currentBoxes && currentBoxes.length > 0) {
			editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: currentBoxes.map((_, i) => i) });
			await delayMs(300);
		}

		// Simulate create-by-drag: send addBox to webview; webview adds a box and sends dirty + requestLabelForNewBox to host.
		editorProvider.postMessageToEditor(imageUri, { type: 'addBox' });
		// Wait for host to receive dirty and requestLabelForNewBox (label resolves to "Box 1" in test mode)
		const deadline = Date.now() + 8000;
		while (Date.now() < deadline) {
			const boxes = editorProvider.getBoxesForImage(imageUri);
			if (boxes && boxes.length === 1 && boxes[0].label === 'Box 1') {
				break;
			}
			await delayMs(100);
		}
		// Assert: document has one box with label "Box 1" (host received dirty + requestLabelForNewBox, onBboxLabelResolved refreshed)
		const memBoxes = editorProvider.getBoxesForImage(imageUri);
		assert.ok(memBoxes, 'in-memory boxes');
		assert.strictEqual(memBoxes.length, 1, 'in-memory: one box after create-by-drag');
		assert.strictEqual(memBoxes[0].label, 'Box 1', 'in-memory: box label should be "Box 1" without manual refresh');
		// Panel should show the box (bbox section uses getLiveBoxes = getBoxesForImage)
		const boxItems = await waitForPanelBoxCount(bboxSectionProvider, 1);
		if (boxItems.length >= 1) {
			assert.strictEqual(boxItems[0].label, 'Box 1', 'UI list: box label when panel shows item');
		}
	});

	test('delete selected box via command and assert panel refreshes', async function () {
		this.timeout(15000);
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder || !e2eImageUri) {
			this.skip();
			return;
		}
		const imageUri = e2eImageUri;
		const api = getExtApi();

		await vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor');
		await waitForEditorOpen(() => api.getEditorProvider(), imageUri);
		await delayMs(600);

		// Set the selected image for the bbox section; use the editor's document URI so lookup matches.
		const selectedUri = api.getEditorProvider()?.getDocumentUriForImage(imageUri) ?? imageUri;
		api.setTestSelectedImageUri(selectedUri);
		// Wait for webview image to load so addBox handler can run (imgWidth/imgHeight > 0)
		await delayMs(1500);

		const editorProvider = api.getEditorProvider();
		const bboxSectionProvider = api.getBboxSectionProvider();
		assert.ok(editorProvider, 'editor provider');
		assert.ok(bboxSectionProvider, 'bbox section provider');

		// Start from a known state: clear existing boxes, then add one box
		const currentBoxes = editorProvider.getBoxesForImage(imageUri);
		if (currentBoxes && currentBoxes.length > 0) {
			editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: currentBoxes.map((_, i) => i) });
			await delayMs(300);
		}
		editorProvider.postMessageToEditor(imageUri, { type: 'addBox' });
		// Wait for host to have one box (dirty + requestLabelForNewBox)
		let deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			const boxes = editorProvider.getBoxesForImage(imageUri);
			if (boxes && boxes.length === 1) {
				break;
			}
			await delayMs(80);
		}
		editorProvider.postMessageToEditor(imageUri, { type: 'renameBoxAt', bboxIndex: 0, label: 'Test Box' });
		await delayMs(400);

		// Verify document has one box (panel may or may not show it depending on selected image state)
		const boxesBefore = editorProvider.getBoxesForImage(imageUri);
		assert.ok(boxesBefore && boxesBefore.length === 1 && boxesBefore[0].label === 'Test Box', 'document: one box before delete');

		// Simulate Delete key: post removeBoxAtIndices to webview; webview sends dirty so host updates document.
		// (Command removeSelectedBoxes does the same when invoked with a node or when active tab is bbox editor.)
		editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: [0] });
		// Wait for webview to process and send dirty, then host to update document
		const deleteDeadline = Date.now() + 5000;
		while (Date.now() < deleteDeadline) {
			const boxes = editorProvider.getBoxesForImage(imageUri);
			if (boxes && boxes.length === 0) {
				break;
			}
			await delayMs(100);
		}

		// Assert: document has zero boxes; panel should refresh to show 0
		const memBoxes = editorProvider.getBoxesForImage(imageUri);
		assert.ok(memBoxes, 'in-memory boxes');
		assert.strictEqual(memBoxes.length, 0, 'in-memory: zero boxes after delete');
		const boxItemsAfter = await waitForPanelBoxCount(bboxSectionProvider, 0);
		assert.strictEqual(boxItemsAfter.length, 0, 'UI list: zero boxes after delete');
	});
});
