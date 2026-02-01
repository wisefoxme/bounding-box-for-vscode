import * as assert from 'assert';
import { getWebviewHtml } from '../editorProvider';
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

	test('getWebviewHtml with selectedBoxIndex embeds initial selected value', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco', 2);
		assert.ok(html.includes('selectedBoxIndex = 2'), 'script should set selectedBoxIndex to 2');
	});

	test('getWebviewHtml without selectedBoxIndex uses null for initial selected', () => {
		const html = getWebviewHtml('x', [], 'y', 'coco');
		assert.ok(html.includes('selectedBoxIndex = null') || html.includes('selectedBoxIndex=null'), 'script should set selectedBoxIndex to null');
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
});
