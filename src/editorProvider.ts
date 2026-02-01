import * as vscode from 'vscode';
import { getBboxUriForImage, getBboxExtension, getDefaultBoundingBoxes, getSettings, readMergedBboxContent } from './settings';
import type { Bbox } from './bbox';
import { getProviderForImage, getProvider } from './formatProviders';
import type { BboxFormatProvider } from './formatProviders';
import { SELECTED_BOX_STATE_PREFIX } from './explorer';

export const ADD_BOX_ON_OPEN_PREFIX = 'addBoxOnOpen_';

export interface BoundingBoxEditorProviderOptions {
	onBboxSaved?: (imageUri: vscode.Uri) => void;
	onEditorOpened?: (imageUri: vscode.Uri) => void;
	onSelectionChanged?: (imageUri: vscode.Uri, selectedBoxIndices: number[]) => void;
	onEditorViewStateChange?: (imageUri: vscode.Uri, active: boolean) => void;
}

class BoundingBoxDocument implements vscode.CustomDocument {
	constructor(
		public readonly uri: vscode.Uri,
		public readonly bboxUri: vscode.Uri,
		public bboxContent: string,
		public boxes: Bbox[],
		public imgWidth: number,
		public imgHeight: number,
		public readonly formatProvider: BboxFormatProvider,
	) {}
	dispose(): void {}
}

function resolveBboxUri(imageUri: vscode.Uri): vscode.Uri | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(imageUri);
	if (!folder) {
		return undefined;
	}
	return getBboxUriForImage(folder, imageUri);
}

export class BoundingBoxEditorProvider implements vscode.CustomReadonlyEditorProvider<BoundingBoxDocument> {
	private readonly _panelsByUri = new Map<string, vscode.WebviewPanel>();

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _options: BoundingBoxEditorProviderOptions = {},
	) {}

	postMessageToEditor(imageUri: vscode.Uri, msg: unknown): void {
		const panel = this._panelsByUri.get(imageUri.toString());
		if (panel) {
			panel.webview.postMessage(msg);
		}
	}

	hasEditorOpen(imageUri: vscode.Uri): boolean {
		return this._panelsByUri.has(imageUri.toString());
	}

	async openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken,
	): Promise<BoundingBoxDocument> {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		let bboxUri: vscode.Uri;
		let bboxContent: string;
		let boxes: Bbox[];
		let formatProvider: BboxFormatProvider;

		if (folder) {
			const merged = await readMergedBboxContent(folder, uri);
			bboxUri = merged.primaryUri;
			bboxContent = merged.content;
			boxes = merged.boxes;
			formatProvider = getProviderForImage(uri) ?? getProvider(getSettings().bboxFormat) ?? getProvider('coco')!;
		} else {
			bboxUri = vscode.Uri.joinPath(uri, '..', uri.path.split('/').pop()!.replace(/\.[^/.]+$/, '') + getBboxExtension());
			bboxContent = '';
			try {
				const buf = await vscode.workspace.fs.readFile(bboxUri);
				bboxContent = new TextDecoder().decode(buf);
			} catch {
				// no bbox file yet; leave bboxContent empty
			}
			const settings = getSettings();
			formatProvider = getProvider(settings.bboxFormat) ?? getProvider('coco')!;
			boxes = formatProvider.parse(bboxContent, 0, 0);
		}

		if (boxes.length === 0) {
			const scope = vscode.workspace.getWorkspaceFolder(uri);
			const defaults = getDefaultBoundingBoxes(scope);
			if (defaults.length > 0) {
				boxes = defaults;
			}
		}
		return new BoundingBoxDocument(uri, bboxUri, bboxContent, boxes, 0, 0, formatProvider);
	}

	async resolveCustomEditor(
		document: BoundingBoxDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		this._panelsByUri.set(document.uri.toString(), webviewPanel);
		webviewPanel.onDidDispose(() => this._panelsByUri.delete(document.uri.toString()));
		webviewPanel.onDidChangeViewState(() => {
			this._options.onEditorViewStateChange?.(document.uri, webviewPanel.active);
		});
		this._options.onEditorViewStateChange?.(document.uri, webviewPanel.active);
		this._options.onEditorOpened?.(document.uri);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(document.uri, '..')],
		};
		const imageSrc = webviewPanel.webview.asWebviewUri(document.uri);
		const settings = getSettings();
		const initialBoxes = document.boxes;
		const formatProvider = document.formatProvider;
		const stateKey = SELECTED_BOX_STATE_PREFIX + document.uri.toString();
		const storedIndex = this._context.workspaceState.get<number>(stateKey);
		const initialSelectedIndices: number[] = storedIndex !== undefined ? [storedIndex] : [];
		if (storedIndex !== undefined) {
			this._context.workspaceState.update(stateKey, undefined);
		}

		const updateWebview = () => {
			webviewPanel.webview.html = getWebviewHtml(
				imageSrc.toString(),
				initialBoxes,
				document.bboxUri.toString(),
				formatProvider.id,
				initialSelectedIndices,
			);
		};
		updateWebview();

		webviewPanel.webview.onDidReceiveMessage(
			async (msg: { type: string; boxes?: Bbox[]; imgWidth?: number; imgHeight?: number; selectedBoxIndices?: number[] }) => {
				if (msg.type === 'init' && msg.imgWidth !== undefined && msg.imgHeight !== undefined) {
					document.imgWidth = msg.imgWidth;
					document.imgHeight = msg.imgHeight;
					// Re-parse if YOLO (needs dimensions)
					if (document.formatProvider.id === 'yolo' && document.bboxContent) {
						document.boxes = document.formatProvider.parse(
							document.bboxContent,
							document.imgWidth,
							document.imgHeight,
						);
						webviewPanel.webview.postMessage({ type: 'boxes', boxes: document.boxes });
					}
					const addBoxKey = ADD_BOX_ON_OPEN_PREFIX + document.uri.toString();
					if (this._context.workspaceState.get<boolean>(addBoxKey)) {
						this._context.workspaceState.update(addBoxKey, undefined);
						webviewPanel.webview.postMessage({ type: 'addBox' });
					}
					return;
				}
				if (msg.type === 'save' && Array.isArray(msg.boxes)) {
					document.boxes = msg.boxes;
					const serialized = document.formatProvider.serialize(
						msg.boxes,
						document.imgWidth,
						document.imgHeight,
					);
					await vscode.workspace.fs.writeFile(document.bboxUri, new TextEncoder().encode(serialized));
					document.bboxContent = serialized;
					this._options.onBboxSaved?.(document.uri);
				}
				if (msg.type === 'selectionChanged' && Array.isArray(msg.selectedBoxIndices)) {
					this._options.onSelectionChanged?.(document.uri, msg.selectedBoxIndices);
				}
			},
		);
	}
}

export function getWebviewHtml(
	imageSrc: string,
	boxes: Bbox[],
	_bboxUri: string,
	_format: string,
	selectedBoxIndices: number[] = [],
): string {
	const boxData = JSON.stringify(boxes).replace(/</g, '\\u003c');
	const safeImageSrc = escapeHtml(imageSrc);
	const initialSelected = JSON.stringify(selectedBoxIndices);
	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: vscode-resource:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body { overflow: hidden; background: #1e1e1e; display: flex; align-items: center; justify-content: center; height: 100vh; }
		#wrap { position: relative; display: inline-block; }
		#img { display: block; max-width: 100%; max-height: 100vh; }
		#overlay { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
		#overlay svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: auto; }
		.bbox { fill: none; stroke: #0f0; stroke-width: 2; cursor: move; pointer-events: stroke; }
		.bbox:hover { stroke: #0ff; }
		.bbox.selected { stroke: #0ff; stroke-width: 3; }
		.handle { fill: #0ff; stroke: #0f0; stroke-width: 1; pointer-events: auto; cursor: default; }
		.handle.n { cursor: n-resize; }
		.handle.s { cursor: s-resize; }
		.handle.e { cursor: e-resize; }
		.handle.w { cursor: w-resize; }
		.handle.ne { cursor: ne-resize; }
		.handle.nw { cursor: nw-resize; }
		.handle.se { cursor: se-resize; }
		.handle.sw { cursor: sw-resize; }
		.bbox-preview { fill: none; stroke: #ff0; stroke-width: 2; stroke-dasharray: 6 4; pointer-events: none; }
	</style>
</head>
<body>
	<div id="wrap">
		<img id="img" src="${safeImageSrc}" alt="Image" />
		<div id="overlay"><svg id="svg"></svg></div>
	</div>
	<script>
		const vscode = acquireVsCodeApi();
		const img = document.getElementById('img');
		const svg = document.getElementById('svg');
		let boxes = ${boxData};
		let imgWidth = 0, imgHeight = 0;
		let selectedBoxIndices = ${initialSelected};
		const HANDLE_SIZE = 8;
		const HIT_MARGIN = 6;
		const MIN_DRAW_PIXELS = 5;
		let drag = null;
		let drawStart = null;
		let drawCurrent = null;

		function notifySelectionChanged() {
			vscode.postMessage({ type: 'selectionChanged', selectedBoxIndices: selectedBoxIndices.slice() });
		}

		function escapeHtml(s) {
			if (typeof s !== 'string') return '';
			const div = document.createElement('div');
			div.textContent = s;
			return div.innerHTML;
		}

		function draw() {
			const w = img.offsetWidth, h = img.offsetHeight;
			if (!w || !h) return;
			const scaleX = w / imgWidth, scaleY = h / imgHeight;
			let html = '';
			for (let i = 0; i < boxes.length; i++) {
				const b = boxes[i];
				const x = b.x_min * scaleX, y = b.y_min * scaleY, wb = b.width * scaleX, hb = b.height * scaleY;
				const sel = selectedBoxIndices.indexOf(i) >= 0 ? ' selected' : '';
				html += '<rect class="bbox' + sel + '" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + wb + '" height="' + hb + '"/>';
			}
			const singleIndex = selectedBoxIndices.length === 1 ? selectedBoxIndices[0] : null;
			if (singleIndex !== null && boxes[singleIndex]) {
				const b = boxes[singleIndex];
				const x = b.x_min * scaleX, y = b.y_min * scaleY, wb = b.width * scaleX, hb = b.height * scaleY;
				const hs = HANDLE_SIZE / 2;
				const handles = [
					{ id: 'n',  x: x + wb/2 - hs, y: y - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'n' },
					{ id: 's',  x: x + wb/2 - hs, y: y + hb - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 's' },
					{ id: 'e',  x: x + wb - hs, y: y + hb/2 - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'e' },
					{ id: 'w',  x: x - hs, y: y + hb/2 - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'w' },
					{ id: 'ne', x: x + wb - hs, y: y - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'ne' },
					{ id: 'nw', x: x - hs, y: y - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'nw' },
					{ id: 'se', x: x + wb - hs, y: y + hb - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'se' },
					{ id: 'sw', x: x - hs, y: y + hb - hs, w: HANDLE_SIZE, h: HANDLE_SIZE, c: 'sw' }
				];
				handles.forEach(function(h) {
					html += '<rect class="handle ' + h.c + '" data-handle="' + h.id + '" data-i="' + singleIndex + '" x="' + h.x + '" y="' + h.y + '" width="' + h.w + '" height="' + h.h + '"/>';
				});
			}
			if (drawStart !== null && drawCurrent !== null && imgWidth > 0 && imgHeight > 0) {
				const x_min = Math.max(0, Math.min(drawStart.x, drawCurrent.x));
				const x_max = Math.min(imgWidth, Math.max(drawStart.x, drawCurrent.x));
				const y_min = Math.max(0, Math.min(drawStart.y, drawCurrent.y));
				const y_max = Math.min(imgHeight, Math.max(drawStart.y, drawCurrent.y));
				const pw = x_max - x_min, ph = y_max - y_min;
				const px = x_min * scaleX, py = y_min * scaleY, pwb = pw * scaleX, phb = ph * scaleY;
				html += '<rect class="bbox-preview" x="' + px + '" y="' + py + '" width="' + pwb + '" height="' + phb + '"/>';
			}
			svg.innerHTML = html;
		}

		function svgCoordsToImage(ev) {
			const rect = svg.getBoundingClientRect();
			const w = img.offsetWidth, h = img.offsetHeight;
			const scaleX = w / imgWidth, scaleY = h / imgHeight;
			const sx = (ev.clientX - rect.left) / scaleX;
			const sy = (ev.clientY - rect.top) / scaleY;
			return { x: sx, y: sy };
		}

		function hitTestHandle(ev) {
			const rect = svg.getBoundingClientRect();
			const w = img.offsetWidth, h = img.offsetHeight;
			const scaleX = w / imgWidth, scaleY = h / imgHeight;
			const px = ev.clientX - rect.left;
			const py = ev.clientY - rect.top;
			const singleIndex = selectedBoxIndices.length === 1 ? selectedBoxIndices[0] : null;
			if (singleIndex === null || !boxes[singleIndex]) return null;
			const b = boxes[singleIndex];
			const x = b.x_min * scaleX, y = b.y_min * scaleY, wb = b.width * scaleX, hb = b.height * scaleY;
			const hs = HANDLE_SIZE / 2;
			const handles = [
				['n',  x + wb/2 - hs, y - hs, HANDLE_SIZE, HANDLE_SIZE],
				['s',  x + wb/2 - hs, y + hb - hs, HANDLE_SIZE, HANDLE_SIZE],
				['e',  x + wb - hs, y + hb/2 - hs, HANDLE_SIZE, HANDLE_SIZE],
				['w',  x - hs, y + hb/2 - hs, HANDLE_SIZE, HANDLE_SIZE],
				['ne', x + wb - hs, y - hs, HANDLE_SIZE, HANDLE_SIZE],
				['nw', x - hs, y - hs, HANDLE_SIZE, HANDLE_SIZE],
				['se', x + wb - hs, y + hb - hs, HANDLE_SIZE, HANDLE_SIZE],
				['sw', x - hs, y + hb - hs, HANDLE_SIZE, HANDLE_SIZE]
			];
			for (let i = 0; i < handles.length; i++) {
				const [id, hx, hy, hw, hh] = handles[i];
				if (px >= hx && px <= hx + hw && py >= hy && py <= hy + hh) return { index: singleIndex, handle: id };
			}
			return null;
		}

		function hitTestEdgeOrBody(ev) {
			const rect = svg.getBoundingClientRect();
			const w = img.offsetWidth, h = img.offsetHeight;
			const scaleX = w / imgWidth, scaleY = h / imgHeight;
			const px = ev.clientX - rect.left;
			const py = ev.clientY - rect.top;
			const m = HIT_MARGIN;
			for (let i = boxes.length - 1; i >= 0; i--) {
				const b = boxes[i];
				const x = b.x_min * scaleX, y = b.y_min * scaleY, wb = b.width * scaleX, hb = b.height * scaleY;
				if (px < x - m || px > x + wb + m || py < y - m || py > y + hb + m) continue;
				if (px >= x + m && px <= x + wb - m && py >= y + m && py <= y + hb - m) return { index: i, handle: 'body' };
				if (px <= x + m && py <= y + m) return { index: i, handle: 'nw' };
				if (px >= x + wb - m && py <= y + m) return { index: i, handle: 'ne' };
				if (px <= x + m && py >= y + hb - m) return { index: i, handle: 'sw' };
				if (px >= x + wb - m && py >= y + hb - m) return { index: i, handle: 'se' };
				if (py <= y + m) return { index: i, handle: 'n' };
				if (py >= y + hb - m) return { index: i, handle: 's' };
				if (px <= x + m) return { index: i, handle: 'w' };
				if (px >= x + wb - m) return { index: i, handle: 'e' };
			}
			return null;
		}

		function applyResize(boxIndex, handle, startImg, curImg, startBox) {
			let x_min = startBox.x_min, y_min = startBox.y_min, width = startBox.width, height = startBox.height;
			const dx = curImg.x - startImg.x, dy = curImg.y - startImg.y;
			if (handle === 'body') {
				x_min = Math.max(0, Math.min(imgWidth - width, startBox.x_min + dx));
				y_min = Math.max(0, Math.min(imgHeight - height, startBox.y_min + dy));
			} else {
				if (handle.indexOf('w') >= 0) { const x_max = x_min + width; x_min = Math.max(0, Math.min(x_max - 1, x_min + dx)); width = x_max - x_min; }
				if (handle.indexOf('e') >= 0) { width = Math.max(1, width + dx); }
				if (handle.indexOf('n') >= 0) { const y_max = y_min + height; y_min = Math.max(0, Math.min(y_max - 1, y_min + dy)); height = y_max - y_min; }
				if (handle.indexOf('s') >= 0) { height = Math.max(1, height + dy); }
			}
			boxes[boxIndex] = { x_min, y_min, width, height, label: startBox.label };
		}

		svg.addEventListener('mousedown', function(e) {
			if (e.button !== 0) return;
			const handleHit = e.target.classList.contains('handle') ? { index: parseInt(e.target.getAttribute('data-i'), 10), handle: e.target.getAttribute('data-handle') } : hitTestHandle(e);
			if (handleHit) {
				const pos = svgCoordsToImage(e);
				drag = { boxIndex: handleHit.index, handle: handleHit.handle, startX: pos.x, startY: pos.y, startBox: Object.assign({}, boxes[handleHit.index]) };
				e.preventDefault();
				return;
			}
			const edgeHit = hitTestEdgeOrBody(e);
			if (edgeHit) {
				if (e.shiftKey) {
					const idx = selectedBoxIndices.indexOf(edgeHit.index);
					if (idx >= 0) selectedBoxIndices.splice(idx, 1);
					else selectedBoxIndices.push(edgeHit.index);
					selectedBoxIndices.sort(function(a,b){ return a - b; });
				} else {
					selectedBoxIndices = [edgeHit.index];
				}
				draw();
				notifySelectionChanged();
				const pos = svgCoordsToImage(e);
				drag = { boxIndex: edgeHit.index, handle: edgeHit.handle, startX: pos.x, startY: pos.y, startBox: Object.assign({}, boxes[edgeHit.index]) };
				e.preventDefault();
			} else {
				selectedBoxIndices = [];
				if (imgWidth > 0 && imgHeight > 0) {
					drawStart = svgCoordsToImage(e);
					drawCurrent = null;
				}
				draw();
				notifySelectionChanged();
			}
		});

		window.addEventListener('mousemove', function(e) {
			if (drawStart !== null) {
				if (imgWidth > 0 && imgHeight > 0) {
					const pos = svgCoordsToImage(e);
					drawCurrent = {
						x: Math.max(0, Math.min(imgWidth, pos.x)),
						y: Math.max(0, Math.min(imgHeight, pos.y))
					};
				}
				draw();
				return;
			}
			if (!drag) return;
			const pos = svgCoordsToImage(e);
			applyResize(drag.boxIndex, drag.handle, { x: drag.startX, y: drag.startY }, pos, drag.startBox);
			draw();
		});

		window.addEventListener('mouseup', function(e) {
			if (e.button !== 0) return;
			if (drag) {
				drag = null;
				vscode.postMessage({ type: 'save', boxes: boxes });
				return;
			}
			if (drawStart !== null) {
				const cur = drawCurrent !== null ? drawCurrent : drawStart;
				const x_min = Math.max(0, Math.min(drawStart.x, cur.x));
				const x_max = Math.min(imgWidth, Math.max(drawStart.x, cur.x));
				const y_min = Math.max(0, Math.min(drawStart.y, cur.y));
				const y_max = Math.min(imgHeight, Math.max(drawStart.y, cur.y));
				const width = x_max - x_min, height = y_max - y_min;
				drawStart = null;
				drawCurrent = null;
				draw();
				if (imgWidth > 0 && imgHeight > 0 && width >= MIN_DRAW_PIXELS && height >= MIN_DRAW_PIXELS) {
					boxes.push({ x_min, y_min, width, height });
					selectedBoxIndices = [boxes.length - 1];
					draw();
					vscode.postMessage({ type: 'save', boxes: boxes });
					notifySelectionChanged();
				}
			}
		});

		img.onload = function() {
			imgWidth = img.naturalWidth;
			imgHeight = img.naturalHeight;
			vscode.postMessage({ type: 'init', imgWidth, imgHeight });
			draw();
		};

		window.addEventListener('message', e => {
			const d = e.data;
			if (d && d.type === 'boxes') { boxes = d.boxes || []; draw(); }
			if (d && d.type === 'selectedBoxIndices' && Array.isArray(d.selectedBoxIndices)) { selectedBoxIndices = d.selectedBoxIndices.slice(); draw(); }
			if (d && d.type === 'addBox') {
				if (imgWidth > 0 && imgHeight > 0) {
					const w = Math.max(50, Math.floor(imgWidth * 0.1));
					const h = Math.max(50, Math.floor(imgHeight * 0.1));
					const x_min = Math.max(0, Math.floor((imgWidth - w) / 2));
					const y_min = Math.max(0, Math.floor((imgHeight - h) / 2));
					boxes.push({ x_min, y_min, width: w, height: h });
					selectedBoxIndices = [boxes.length - 1];
					draw();
					vscode.postMessage({ type: 'save', boxes });
					notifySelectionChanged();
				}
			}
			if (d && d.type === 'removeBoxAt' && typeof d.bboxIndex === 'number') {
				const i = d.bboxIndex;
				if (i >= 0 && i < boxes.length) {
					boxes.splice(i, 1);
					selectedBoxIndices = selectedBoxIndices.filter(function(x){ return x !== i; }).map(function(x){ return x > i ? x - 1 : x; });
					draw();
					vscode.postMessage({ type: 'save', boxes });
					notifySelectionChanged();
				}
			}
			if (d && d.type === 'removeBoxAtIndices' && Array.isArray(d.bboxIndices)) {
				const indices = d.bboxIndices.slice().sort(function(a,b){ return b - a; });
				for (let k = 0; k < indices.length; k++) {
					const i = indices[k];
					if (i >= 0 && i < boxes.length) boxes.splice(i, 1);
				}
				selectedBoxIndices = [];
				draw();
				vscode.postMessage({ type: 'save', boxes });
				notifySelectionChanged();
			}
			if (d && d.type === 'renameBoxAt' && typeof d.bboxIndex === 'number' && typeof d.label === 'string') {
				const i = d.bboxIndex;
				if (i >= 0 && i < boxes.length) {
					boxes[i] = Object.assign({}, boxes[i], { label: d.label });
					draw();
					vscode.postMessage({ type: 'save', boxes });
				}
			}
		});

		svg.addEventListener('dblclick', function(e) {
			const rect = e.target.closest('.bbox');
			if (!rect) return;
			const i = parseInt(rect.getAttribute('data-i'), 10);
			boxes.splice(i, 1);
			selectedBoxIndices = selectedBoxIndices.filter(function(x){ return x !== i; }).map(function(x){ return x > i ? x - 1 : x; });
			draw();
			vscode.postMessage({ type: 'save', boxes });
			notifySelectionChanged();
		});

		window.addEventListener('keydown', function(e) {
			if (e.key !== 'Delete' && e.key !== 'Backspace') return;
			if (selectedBoxIndices.length === 0) return;
			const indices = selectedBoxIndices.slice().sort(function(a,b){ return b - a; });
			for (let k = 0; k < indices.length; k++) {
				const i = indices[k];
				if (i >= 0 && i < boxes.length) boxes.splice(i, 1);
			}
			selectedBoxIndices = [];
			draw();
			vscode.postMessage({ type: 'save', boxes });
			notifySelectionChanged();
			e.preventDefault();
		});
	</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
	const div = { textContent: s };
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
