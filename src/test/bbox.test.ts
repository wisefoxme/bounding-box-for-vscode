import * as assert from 'assert';
import {
	parseCoco,
	serializeCoco,
	parseYolo,
	serializeYolo,
	parsePascalVoc,
	serializePascalVoc,
	parseBbox,
	serializeBbox,
	type Bbox,
} from '../bbox';

suite('bbox', () => {
	suite('COCO', () => {
		test('parseCoco parses lines', () => {
			const boxes = parseCoco('10 20 30 40\n50 60 70 80');
			assert.strictEqual(boxes.length, 2);
			assert.strictEqual(boxes[0].x_min, 10);
			assert.strictEqual(boxes[0].y_min, 20);
			assert.strictEqual(boxes[0].width, 30);
			assert.strictEqual(boxes[0].height, 40);
			assert.strictEqual(boxes[1].x_min, 50);
			assert.strictEqual(boxes[1].y_min, 60);
			assert.strictEqual(boxes[1].width, 70);
			assert.strictEqual(boxes[1].height, 80);
		});
		test('parseCoco parses optional label', () => {
			const boxes = parseCoco('10 20 30 40 person');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].label, 'person');
		});
		test('parseCoco preserves label with spaces', () => {
			const boxes = parseCoco('10 20 30 40 Second Box');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].label, 'Second Box');
		});
		test('parseCoco ignores invalid lines', () => {
			const boxes = parseCoco('10 20\n1 2 3');
			assert.strictEqual(boxes.length, 0);
		});
		test('parseCoco handles empty', () => {
			assert.strictEqual(parseCoco('').length, 0);
			assert.strictEqual(parseCoco('   \n  ').length, 0);
		});
		test('serializeCoco round-trip', () => {
			const boxes: Bbox[] = [
				{ x_min: 10, y_min: 20, width: 30, height: 40 },
				{ x_min: 50, y_min: 60, width: 70, height: 80, label: 'cat' },
			];
			const s = serializeCoco(boxes);
			const back = parseCoco(s);
			assert.strictEqual(back.length, 2);
			assert.strictEqual(back[0].x_min, 10);
			assert.strictEqual(back[1].label, 'cat');
		});
	});

	suite('YOLO', () => {
		test('parseYolo normalizes to pixels', () => {
			const boxes = parseYolo('0 0.5 0.5 0.2 0.2', 100, 100);
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].x_min, 40);
			assert.strictEqual(boxes[0].y_min, 40);
			assert.strictEqual(boxes[0].width, 20);
			assert.strictEqual(boxes[0].height, 20);
			assert.strictEqual(boxes[0].label, '0');
		});
		test('parseYolo returns empty when dimensions zero', () => {
			assert.strictEqual(parseYolo('0 0.5 0.5 0.2 0.2', 0, 100).length, 0);
			assert.strictEqual(parseYolo('0 0.5 0.5 0.2 0.2', 100, 0).length, 0);
		});
		test('serializeYolo returns empty when dimensions zero', () => {
			const boxes: Bbox[] = [{ x_min: 10, y_min: 20, width: 30, height: 40 }];
			assert.strictEqual(serializeYolo(boxes, 0, 100), '');
			assert.strictEqual(serializeYolo(boxes, 100, 0), '');
		});
		test('serializeYolo round-trip', () => {
			const boxes: Bbox[] = [
				{ x_min: 10, y_min: 20, width: 30, height: 40, label: '1' },
			];
			const s = serializeYolo(boxes, 100, 100);
			const back = parseYolo(s, 100, 100);
			assert.strictEqual(back.length, 1);
			assert.strictEqual(back[0].x_min, 10);
			assert.strictEqual(back[0].y_min, 20);
			assert.strictEqual(back[0].width, 30);
			assert.strictEqual(back[0].height, 40);
		});
	});

	suite('Pascal VOC', () => {
		test('parsePascalVoc converts to x_min y_min width height', () => {
			const boxes = parsePascalVoc('10 20 40 60');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].x_min, 10);
			assert.strictEqual(boxes[0].y_min, 20);
			assert.strictEqual(boxes[0].width, 30);
			assert.strictEqual(boxes[0].height, 40);
		});
		test('parsePascalVoc optional label', () => {
			const boxes = parsePascalVoc('0 0 10 10 dog');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].label, 'dog');
		});
		test('parsePascalVoc preserves label with spaces', () => {
			const boxes = parsePascalVoc('0 0 10 10 My Label Here');
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].label, 'My Label Here');
		});
		test('serializePascalVoc round-trip', () => {
			const boxes: Bbox[] = [
				{ x_min: 10, y_min: 20, width: 30, height: 40 },
			];
			const s = serializePascalVoc(boxes);
			const back = parsePascalVoc(s);
			assert.strictEqual(back.length, 1);
			assert.strictEqual(back[0].x_min, 10);
			assert.strictEqual(back[0].width, 30);
		});
	});

	suite('parseBbox / serializeBbox', () => {
		test('coco format', () => {
			const boxes = parseBbox('1 2 3 4', 'coco', 0, 0);
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].x_min, 1);
			const s = serializeBbox(boxes, 'coco', 0, 0);
			assert.ok(s.includes('1 2 3 4'));
		});
		test('yolo format uses dimensions', () => {
			const boxes = parseBbox('0 0.5 0.5 0.2 0.2', 'yolo', 100, 100);
			assert.strictEqual(boxes.length, 1);
			const s = serializeBbox(boxes, 'yolo', 100, 100);
			const back = parseBbox(s, 'yolo', 100, 100);
			assert.strictEqual(back.length, 1);
		});
		test('pascal_voc format', () => {
			const boxes = parseBbox('10 20 40 60', 'pascal_voc', 0, 0);
			assert.strictEqual(boxes.length, 1);
			assert.strictEqual(boxes[0].width, 30);
			const s = serializeBbox(boxes, 'pascal_voc', 0, 0);
			assert.ok(s.includes('10 20 40 60'));
		});
		test('unknown format defaults to coco', () => {
			const boxes = parseBbox('5 10 15 20', 'coco', 0, 0);
			assert.strictEqual(boxes.length, 1);
		});
	});
});
