import * as assert from 'assert';
import * as vscode from 'vscode';
import { BoundingBoxEditorProvider, getWebviewHtml } from '../editorProvider';
import type { Bbox } from '../bbox';

suite('editorProvider', () => {
	test('getWebviewHtml returns HTML with image and script', () => {
		const html = getWebviewHtml('https://example.com/img.png', [], 'file:///bbox.txt', 'coco');
		assert.ok(html.includes('<!DOCTYPE html>'));
		assert.ok(html.includes('id="img"'));
		assert.ok(html.includes('id="svg"'));
		assert.ok(html.includes('bbox'));
		assert.ok(html.includes('acquireVsCodeApi'));
	});

	test('getWebviewHtml embeds box data', () => {
		const boxes: Bbox[] = [{ x_min: 10, y_min: 20, width: 30, height: 40 }];
		const html = getWebviewHtml('x', boxes, 'y', 'coco');
		assert.ok(html.includes('"x_min":10'));
		assert.ok(html.includes('"y_min":20'));
		assert.ok(html.includes('"width":30'));
		assert.ok(html.includes('"height":40'));
	});

	test('getWebviewHtml with selectedBoxIndices embeds initial selected value', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco', [2]);
		assert.ok(html.includes('selectedBoxIndices = [2]'), 'script should set selectedBoxIndices to [2]');
	});

	test('getWebviewHtml without selectedBoxIndices uses empty array for initial selected', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes('selectedBoxIndices = []'), 'script should set selectedBoxIndices to []');
	});

	test('getWebviewHtml includes resize handle and drag logic', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes('handle'));
		assert.ok(html.includes('applyResize'));
		assert.ok(html.includes('hitTestEdgeOrBody'));
		assert.ok(html.includes('save'));
	});

	test('getWebviewHtml includes draw-new-box behavior (bbox-preview and drawStart)', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes('bbox-preview'), 'script should render preview rect class');
		assert.ok(html.includes('drawStart'), 'script should track draw start');
		assert.ok(html.includes('drawCurrent'), 'script should track draw current');
		assert.ok(html.includes('MIN_DRAW_PIXELS'), 'script should enforce minimum draw size');
	});

	test('getWebviewHtml includes selectionChanged and keydown remove and removeBoxAt', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes('selectionChanged'), 'script should post selectionChanged');
		assert.ok(html.includes('notifySelectionChanged'), 'script should notify selection changes');
		assert.ok(html.includes('keydown'), 'script should handle keydown');
		assert.ok(html.includes('removeBoxAt') || html.includes('removeBoxAtIndices'), 'script should handle remove message');
		assert.ok(html.includes('renameBoxAt'), 'script should handle renameBoxAt message');
	});

	test('getWebviewHtml sends boxes with dirty', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes("type: 'dirty', boxes: boxes"), 'script should send boxes with dirty');
	});

	test('getWebviewHtml includes requestLabelForNewBox after draw and addBox', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes('requestLabelForNewBox'), 'script should post requestLabelForNewBox');
		assert.ok(html.includes('bboxIndex: boxes.length - 1'), 'script should send bboxIndex for new box');
	});

	test('dirty message with boxes updates document.boxes and calls onBoxesChanged', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, `dirty-test-${Date.now()}.png`);
		const onBoxesChangedCalls: vscode.Uri[] = [];
		let messageListener: (msg: { type: string; boxes?: Bbox[] }) => void = () => {};
		const mockWebview = {
			onDidReceiveMessage: (listener: (msg: { type: string; boxes?: Bbox[] }) => void) => {
				messageListener = listener;
				return { dispose: () => {} };
			},
			postMessage: () => {},
			asWebviewUri: (uri: vscode.Uri) => uri,
			html: '',
			options: {} as vscode.WebviewOptions,
		};
		const mockPanel = {
			webview: mockWebview,
			onDidDispose: () => ({ dispose: () => {} }),
			onDidChangeViewState: () => ({ dispose: () => {} }),
			active: true,
		} as unknown as vscode.WebviewPanel;
		const mockContext = {
			workspaceState: { get: () => undefined, update: () => {} },
			subscriptions: [] as { dispose(): void }[],
		} as unknown as vscode.ExtensionContext;
		const provider = new BoundingBoxEditorProvider(mockContext, {
			onBoxesChanged: (uri) => onBoxesChangedCalls.push(uri),
			getWriteBboxFile: () => async () => {},
		});
		const doc = await provider.openCustomDocument(
			imageUri,
			{} as vscode.CustomDocumentOpenContext,
			new vscode.CancellationTokenSource().token,
		);
		await provider.resolveCustomEditor(
			doc,
			mockPanel,
			new vscode.CancellationTokenSource().token,
		);
		const newBoxes: Bbox[] = [{ x_min: 0, y_min: 0, width: 100, height: 100 }];
		messageListener({ type: 'dirty', boxes: newBoxes });
		assert.strictEqual(onBoxesChangedCalls.length, 1, 'onBoxesChanged called once');
		assert.strictEqual(onBoxesChangedCalls[0].toString(), doc.uri.toString(), 'onBoxesChanged called with document URI');
		const liveBoxes = provider.getBoxesForImage(doc.uri);
		assert.ok(liveBoxes, 'getBoxesForImage returns array');
		assert.strictEqual(liveBoxes!.length, 1, 'one box');
		assert.strictEqual(liveBoxes![0].x_min, 0);
		assert.strictEqual(liveBoxes![0].width, 100);
	});

	test('requestLabelForNewBox updates document box label and calls onBoxesChanged', async () => {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return;
		}
		const imageUri = vscode.Uri.joinPath(folders[0].uri, `rename-test-${Date.now()}.png`);
		const onBoxesChangedCalls: vscode.Uri[] = [];
		let messageListener: (msg: { type: string; boxes?: Bbox[]; bboxIndex?: number }) => void = () => {};
		const mockWebview = {
			onDidReceiveMessage: (listener: (msg: { type: string; boxes?: Bbox[]; bboxIndex?: number }) => void) => {
				messageListener = listener;
				return { dispose: () => {} };
			},
			postMessage: () => {},
			asWebviewUri: (uri: vscode.Uri) => uri,
			html: '',
			options: {} as vscode.WebviewOptions,
		};
		const mockPanel = {
			webview: mockWebview,
			onDidDispose: () => ({ dispose: () => {} }),
			onDidChangeViewState: () => ({ dispose: () => {} }),
			active: true,
		} as unknown as vscode.WebviewPanel;
		const mockContext = {
			workspaceState: { get: () => undefined, update: () => {} },
			subscriptions: [] as { dispose(): void }[],
		} as unknown as vscode.ExtensionContext;
		const provider = new BoundingBoxEditorProvider(mockContext, {
			onBoxesChanged: (uri) => onBoxesChangedCalls.push(uri),
			onRequestLabelForNewBox: () => Promise.resolve('My Label'),
			getWriteBboxFile: () => async () => {},
		});
		const doc = await provider.openCustomDocument(
			imageUri,
			{} as vscode.CustomDocumentOpenContext,
			new vscode.CancellationTokenSource().token,
		);
		await provider.resolveCustomEditor(
			doc,
			mockPanel,
			new vscode.CancellationTokenSource().token,
		);
		messageListener({ type: 'dirty', boxes: [{ x_min: 0, y_min: 0, width: 50, height: 50 }] });
		assert.strictEqual(provider.getBoxesForImage(doc.uri)?.length, 1, 'one box after dirty');
		onBoxesChangedCalls.length = 0;
		messageListener({ type: 'requestLabelForNewBox', bboxIndex: 0 });
		await new Promise((r) => setTimeout(r, 20));
		assert.strictEqual(onBoxesChangedCalls.length, 1, 'onBoxesChanged called once after rename');
		assert.strictEqual(onBoxesChangedCalls[0].toString(), doc.uri.toString(), 'onBoxesChanged called with document URI');
		const liveBoxes = provider.getBoxesForImage(doc.uri);
		assert.ok(liveBoxes, 'getBoxesForImage returns array');
		assert.strictEqual(liveBoxes!.length, 1, 'one box');
		assert.strictEqual(liveBoxes![0].label, 'My Label', 'document box has resolved label');
	});
});
