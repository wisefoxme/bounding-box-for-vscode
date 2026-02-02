import { defineConfig } from '@vscode/test-cli';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal 1x1 PNG for E2E dummy image. */
const MINIMAL_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const tempDir = fs.mkdtempSync(path.join(os.platform() === 'win32' ? os.tmpdir() : '/tmp', 'bbox-e2e-'));
const samplePng = path.join(tempDir, 'sample.png');
const sampleTxt = path.join(tempDir, 'sample.txt');

const pngBuffer = Buffer.from(MINIMAL_PNG_BASE64, 'base64');
fs.writeFileSync(samplePng, pngBuffer);
// Dummy COCO line: x y width height (optional label)
fs.writeFileSync(sampleTxt, '0 0 10 10 Dummy\n', 'utf8');

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: tempDir,
});
