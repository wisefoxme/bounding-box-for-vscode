import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	cocoProvider,
	yoloProvider,
	pascalVocProvider,
	tesseractBoxProvider,
	detect,
	getProvider,
	getProviderForImage,
	setProviderForImage,
} from '../formatProviders';
import type { Bbox } from '../bbox';

suite('formatProviders', () => {
	suite('cocoProvider', () => {
		test('parse returns boxes from COCO lines', () => {
			const boxes = cocoProvider.parse('10 20 30 40\n50 60 70 80 label');
			assert.strictEqual(boxes.length, 2);
			assert.strictEqual(boxes[0].x_min, 10);
			assert.strictEqual(boxes[0].y_min, 20);
			assert.strictEqual(boxes[0].width, 30);
			assert.strictEqual(boxes[0].height, 40);
			assert.strictEqual(boxes[1].label, 'label');
		});
		test('serialize round-trip', () => {
			const boxes: Bbox[] = [{ x_min: 1, y_min: 2, width: 3, height: 4, label: 'a' }];
			const s = cocoProvider.serialize(boxes);
			const back = cocoProvider.parse(s);
			assert.deepStrictEqual(back, boxes);
		});
		test('detect returns true for COCO-style content', () => {
			assert.strictEqual(cocoProvider.detect('10 20 30 40\n50 60 70 80'), true);
		});
		test('detect returns false for empty', () => {
			assert.strictEqual(cocoProvider.detect(''), false);
		});
	});

	suite('yoloProvider', () => {
		test('parse returns boxes with dimensions', () => {
			const boxes = yoloProvider.parse('0 0.5 0.5 0.2 0.2', 100, 100);
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].label, '0');
			assert.ok(boxes[0].x_min >= 0 && boxes[0].width > 0);
		});
		test('serialize round-trip with dimensions', () => {
			const boxes: Bbox[] = [{ x_min: 10, y_min: 20, width: 30, height: 40, label: '1' }];
			const s = yoloProvider.serialize(boxes, 100, 100);
			const back = yoloProvider.parse(s, 100, 100);
			assert.strictEqual(back.length, 1);
			assert.strictEqual(back[0].label, '1');
		});
		test('detect returns true for normalized floats', () => {
			assert.strictEqual(yoloProvider.detect('0 0.5 0.5 0.1 0.1\n1 0.2 0.3 0.4 0.5'), true);
		});
	});

	suite('pascalVocProvider', () => {
		test('parse returns boxes from x_min y_min x_max y_max', () => {
			const boxes = pascalVocProvider.parse('10 20 40 60');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].x_min, 10);
			assert.strictEqual(boxes[0].y_min, 20);
			assert.strictEqual(boxes[0].width, 30);
			assert.strictEqual(boxes[0].height, 40);
		});
		test('serialize round-trip', () => {
			const boxes: Bbox[] = [{ x_min: 10, y_min: 20, width: 30, height: 40 }];
			const s = pascalVocProvider.serialize(boxes);
			const back = pascalVocProvider.parse(s);
			assert.strictEqual(back.length, 1);
			assert.strictEqual(back[0].x_min, boxes[0].x_min);
			assert.strictEqual(back[0].y_min, boxes[0].y_min);
			assert.strictEqual(back[0].width, boxes[0].width);
			assert.strictEqual(back[0].height, boxes[0].height);
		});
		test('detect returns true for x_max > x_min lines', () => {
			assert.strictEqual(pascalVocProvider.detect('10 20 40 60\n0 0 10 10'), true);
		});
	});

	suite('tesseractBoxProvider', () => {
		test('parse label x_min y_min x_max y_max (label can be multi-char)', () => {
			const content = 'G 0 0 745 1040 0\nLand 10 20 30 40';
			const boxes = tesseractBoxProvider.parse(content);
			assert.strictEqual(boxes.length, 2);
			assert.strictEqual(boxes[0].label, 'G');
			assert.strictEqual(boxes[0].x_min, 0);
			assert.strictEqual(boxes[0].y_min, 0);
			assert.strictEqual(boxes[0].width, 745);
			assert.strictEqual(boxes[0].height, 1040);
			assert.strictEqual(boxes[1].label, 'Land');
			assert.strictEqual(boxes[1].x_min, 10);
			assert.strictEqual(boxes[1].y_min, 20);
			assert.strictEqual(boxes[1].width, 20);
			assert.strictEqual(boxes[1].height, 20);
		});
		test('parse 5-token line (label x_min y_min x_max y_max)', () => {
			const boxes = tesseractBoxProvider.parse('Land 10 20 30 40');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].label, 'Land');
			assert.strictEqual(boxes[0].x_min, 10);
			assert.strictEqual(boxes[0].y_min, 20);
			assert.strictEqual(boxes[0].width, 20);
			assert.strictEqual(boxes[0].height, 20);
		});
		test('serialize round-trip', () => {
			const boxes: Bbox[] = [
				{ x_min: 10, y_min: 20, width: 30, height: 40, label: 'word' },
			];
			const s = tesseractBoxProvider.serialize(boxes);
			const back = tesseractBoxProvider.parse(s);
			assert.strictEqual(back.length, 1);
			assert.strictEqual(back[0].label, 'word');
			assert.strictEqual(back[0].x_min, 10);
			assert.strictEqual(back[0].y_min, 20);
			assert.strictEqual(back[0].width, 30);
			assert.strictEqual(back[0].height, 40);
		});
		test('detect returns true for Tesseract .box style lines', () => {
			const content = 'G 0 0 745 1040 0\nr 0 0 745 1040 0';
			assert.strictEqual(tesseractBoxProvider.detect(content), true);
		});
	});

	suite('registry', () => {
		test('getProvider returns provider by id', () => {
			assert.strictEqual(getProvider('coco'), cocoProvider);
			assert.strictEqual(getProvider('yolo'), yoloProvider);
			assert.strictEqual(getProvider('pascal_voc'), pascalVocProvider);
			assert.strictEqual(getProvider('tesseract_box'), tesseractBoxProvider);
			assert.strictEqual(getProvider('unknown'), undefined);
		});
		test('detect returns tesseract_box for .box-style content', () => {
			const content = 'G 0 0 745 1040 0\nr 0 0 745 1040 0\nu 0 0 745 1040 0';
			const provider = detect(content);
			assert.ok(provider);
			assert.strictEqual(provider!.id, 'tesseract_box');
		});
		test('detect returns coco when Pascal does not match (x_max <= x_min)', () => {
			const content = '10 20 5 5\n50 60 5 5';
			const provider = detect(content);
			assert.ok(provider);
			assert.strictEqual(provider!.id, 'coco');
		});
		test('detect returns yolo for normalized float lines', () => {
			const content = '0 0.5 0.5 0.2 0.2\n0 0.1 0.1 0.1 0.1';
			const provider = detect(content);
			assert.ok(provider);
			assert.strictEqual(provider!.id, 'yolo');
		});
		test('getProviderForImage and setProviderForImage session cache', () => {
			const uri = vscode.Uri.file('/fake/image.png');
			assert.strictEqual(getProviderForImage(uri), undefined);
			setProviderForImage(uri, tesseractBoxProvider);
			assert.strictEqual(getProviderForImage(uri), tesseractBoxProvider);
		});
	});
});
