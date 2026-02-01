import * as vscode from 'vscode';
import { getBboxDirUri, getBboxExtension, getSettings } from './settings';
import type { Bbox } from './bbox';
import { parseBbox, serializeBbox } from './bbox';
import { SELECTED_BOX_STATE_PREFIX } from './explorer';

class BoundingBoxDocument implements vscode.CustomDocument {
	constructor(
		public readonly uri: vscode.Uri,
		public readonly bboxUri: vscode.Uri,
		public bboxContent: string,
		public boxes: Bbox[],
		public imgWidth: number,
		public imgHeight: number,
	) {}
	dispose(): void {}
}

function resolveBboxUri(imageUri: vscode.Uri): vscode.Uri | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(imageUri);
	if (!folder) {
		return undefined;
	}
	const bboxDir = getBboxDirUri(folder);
	const base = imageUri.path.replace(/\.[^/.]+$/, '');
	const baseName = base.split('/').pop() ?? '';
	return vscode.Uri.joinPath(bboxDir, baseName + getBboxExtension());
}

export class BoundingBoxEditorProvider implements vscode.CustomReadonlyEditorProvider<BoundingBoxDocument> {
	constructor(private readonly _context: vscode.ExtensionContext) {}

	async openCustomDocument(
		uri: vscode.Uri,
		_openContext: vscode.CustomDocumentOpenContext,
		_token: vscode.CancellationToken,
	): Promise<BoundingBoxDocument> {
		const bboxUri = resolveBboxUri(uri) ?? vscode.Uri.joinPath(uri, '..', uri.path.split('/').pop()!.replace(/\.[^/.]+$/, '') + getBboxExtension());
		let bboxContent = '';
		try {
			const buf = await vscode.workspace.fs.readFile(bboxUri);
			bboxContent = new TextDecoder().decode(buf);
		} catch {
			// no bbox file yet; leave bboxContent empty
		}
		const settings = getSettings();
		// Image dimensions unknown until webview loads; use 0 for non-YOLO
		const boxes = parseBbox(bboxContent, settings.bboxFormat, 0, 0);
		return new BoundingBoxDocument(uri, bboxUri, bboxContent, boxes, 0, 0);
	}

	async resolveCustomEditor(
		document: BoundingBoxDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken,
	): Promise<void> {
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(document.uri, '..')],
		};
		const imageSrc = webviewPanel.webview.asWebviewUri(document.uri);
		const settings = getSettings();
		const initialBoxes = document.boxes;
		const stateKey = SELECTED_BOX_STATE_PREFIX + document.uri.toString();
		let selectedBoxIndex: number | undefined = this._context.workspaceState.get<number>(stateKey);
		if (selectedBoxIndex !== undefined) {
			this._context.workspaceState.update(stateKey, undefined);
		}

		const updateWebview = () => {
			webviewPanel.webview.html = getWebviewHtml(
				imageSrc.toString(),
				initialBoxes,
				document.bboxUri.toString(),
				settings.bboxFormat,
				selectedBoxIndex,
			);
		};
		updateWebview();

		webviewPanel.webview.onDidReceiveMessage(async (msg: { type: string; boxes?: Bbox[]; imgWidth?: number; imgHeight?: number }) => {
			if (msg.type === 'init' && msg.imgWidth !== undefined && msg.imgHeight !== undefined) {
				document.imgWidth = msg.imgWidth;
				document.imgHeight = msg.imgHeight;
				// Re-parse if YOLO (needs dimensions)
				if (settings.bboxFormat === 'yolo' && document.bboxContent) {
					document.boxes = parseBbox(document.bboxContent, 'yolo', document.imgWidth, document.imgHeight);
					webviewPanel.webview.postMessage({ type: 'boxes', boxes: document.boxes });
				}
				return;
			}
			if (msg.type === 'save' && Array.isArray(msg.boxes)) {
				document.boxes = msg.boxes;
				const serialized = serializeBbox(msg.boxes, settings.bboxFormat, document.imgWidth, document.imgHeight);
				await vscode.workspace.fs.writeFile(document.bboxUri, new TextEncoder().encode(serialized));
				document.bboxContent = serialized;
			}
		});
	}
}

export function getWebviewHtml(
	imageSrc: string,
	boxes: Bbox[],
	_bboxUri: string,
	_format: string,
	selectedBoxIndex?: number,
): string {
	const boxData = JSON.stringify(boxes).replace(/</g, '\\u003c');
	const safeImageSrc = escapeHtml(imageSrc);
	const initialSelected = selectedBoxIndex !== undefined ? selectedBoxIndex : 'null';
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
		let selectedBoxIndex = ${initialSelected};
		const HANDLE_SIZE = 8;
		const HIT_MARGIN = 6;
		let drag = null;

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
				const sel = selectedBoxIndex === i ? ' selected' : '';
				html += '<rect class="bbox' + sel + '" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + wb + '" height="' + hb + '"/>';
			}
			if (selectedBoxIndex !== null && selectedBoxIndex !== undefined && boxes[selectedBoxIndex]) {
				const b = boxes[selectedBoxIndex];
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
					html += '<rect class="handle ' + h.c + '" data-handle="' + h.id + '" data-i="' + selectedBoxIndex + '" x="' + h.x + '" y="' + h.y + '" width="' + h.w + '" height="' + h.h + '"/>';
				});
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
			if (selectedBoxIndex === null || selectedBoxIndex === undefined || !boxes[selectedBoxIndex]) return null;
			const b = boxes[selectedBoxIndex];
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
				if (px >= hx && px <= hx + hw && py >= hy && py <= hy + hh) return { index: selectedBoxIndex, handle: id };
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
				selectedBoxIndex = edgeHit.index;
				draw();
				const pos = svgCoordsToImage(e);
				drag = { boxIndex: edgeHit.index, handle: edgeHit.handle, startX: pos.x, startY: pos.y, startBox: Object.assign({}, boxes[edgeHit.index]) };
				e.preventDefault();
			} else {
				selectedBoxIndex = null;
				draw();
			}
		});

		window.addEventListener('mousemove', function(e) {
			if (!drag) return;
			const pos = svgCoordsToImage(e);
			applyResize(drag.boxIndex, drag.handle, { x: drag.startX, y: drag.startY }, pos, drag.startBox);
			draw();
		});

		window.addEventListener('mouseup', function(e) {
			if (e.button !== 0 || !drag) return;
			drag = null;
			vscode.postMessage({ type: 'save', boxes: boxes });
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
			if (d && d.type === 'selectedBoxIndex') { selectedBoxIndex = d.selectedBoxIndex; draw(); }
		});

		svg.addEventListener('dblclick', function(e) {
			const rect = e.target.closest('.bbox');
			if (!rect) return;
			const i = parseInt(rect.getAttribute('data-i'), 10);
			boxes.splice(i, 1);
			if (selectedBoxIndex === i) selectedBoxIndex = null;
			else if (selectedBoxIndex !== null && selectedBoxIndex > i) selectedBoxIndex--;
			draw();
			vscode.postMessage({ type: 'save', boxes });
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
