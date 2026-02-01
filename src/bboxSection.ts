import * as vscode from 'vscode';
import { getBboxUriForImage, getSettings } from './settings';
import { parseBbox } from './bbox';
import type { Bbox } from './bbox';
import { getSelectedImageUri, getSelectedBoxIndices } from './selectedImage';
import { BoxTreeItem } from './explorer';

const OPEN_IMAGE_WITH_BOX_COMMAND = 'bounding-box-editor.openImageWithBox';

function resolveBboxUri(imageUri: vscode.Uri): vscode.Uri | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(imageUri);
	if (!folder) {
		return undefined;
	}
	return getBboxUriForImage(folder, imageUri);
}

export class BboxSectionPlaceholderItem extends vscode.TreeItem {
	constructor(message = 'Select an image from Project') {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'placeholder';
	}
}

export type BboxSectionTreeItem = BoxTreeItem | BboxSectionPlaceholderItem;

export class BboxSectionTreeDataProvider implements vscode.TreeDataProvider<BboxSectionTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<BboxSectionTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: BboxSectionTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: BboxSectionTreeItem): Promise<BboxSectionTreeItem[]> {
		if (element !== undefined) {
			return [];
		}

		const imageUri = getSelectedImageUri();
		if (!imageUri) {
			return [new BboxSectionPlaceholderItem()];
		}

		const bboxUri = resolveBboxUri(imageUri);
		if (!bboxUri) {
			return [new BboxSectionPlaceholderItem('Open the image and draw on the canvas to add boxes')];
		}

		let content: string;
		try {
			await vscode.workspace.fs.stat(bboxUri);
		} catch {
			return [new BboxSectionPlaceholderItem('Open the image and draw on the canvas to add boxes')];
		}
		try {
			const buf = await vscode.workspace.fs.readFile(bboxUri);
			content = new TextDecoder().decode(buf);
		} catch {
			return [new BboxSectionPlaceholderItem('Open the image and draw on the canvas to add boxes')];
		}

		const settings = getSettings();
		const items: BboxSectionTreeItem[] = [];
		const selectedIndices = getSelectedBoxIndices();

		if (settings.bboxFormat === 'yolo') {
			const lines = content.trim().split(/\r?\n/).filter(Boolean);
			for (let i = 0; i < lines.length; i++) {
				items.push(new BoxTreeItem(imageUri, i, `Box ${i + 1}`, { selected: selectedIndices.includes(i) }));
			}
		} else {
			const boxes: Bbox[] = parseBbox(content, settings.bboxFormat, 0, 0);
			for (let i = 0; i < boxes.length; i++) {
				const b = boxes[i];
				const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
				const description = `x:${Math.round(b.x_min)} y:${Math.round(b.y_min)} w:${Math.round(b.width)} h:${Math.round(b.height)}`;
				items.push(new BoxTreeItem(imageUri, i, label, {
					description,
					selected: selectedIndices.includes(i),
				}));
			}
		}

		return items;
	}
}

export { OPEN_IMAGE_WITH_BOX_COMMAND };
