import * as vscode from 'vscode';
import { getBboxDirUri, getBboxExtension, getSettings } from './settings';
import { parseBbox } from './bbox';
import type { Bbox } from './bbox';
import { getSelectedImageUri } from './selectedImage';
import { BoxTreeItem } from './explorer';

const CREATE_NEW_BBOX_COMMAND = 'bounding-box-editor.createNewBbox';
const OPEN_IMAGE_WITH_BOX_COMMAND = 'bounding-box-editor.openImageWithBox';

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

export class CreateNewBoxItem extends vscode.TreeItem {
	constructor(public readonly imageUri: vscode.Uri) {
		super('Create new bounding box', vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'createBbox';
		this.iconPath = new vscode.ThemeIcon('add');
		this.command = {
			command: CREATE_NEW_BBOX_COMMAND,
			title: 'Create new bounding box',
			arguments: [imageUri],
		};
	}
}

export class BboxSectionPlaceholderItem extends vscode.TreeItem {
	constructor() {
		super('Select an image from Project', vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'placeholder';
	}
}

export type BboxSectionTreeItem = CreateNewBoxItem | BoxTreeItem | BboxSectionPlaceholderItem;

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
			return [new CreateNewBoxItem(imageUri)];
		}

		let content: string;
		try {
			await vscode.workspace.fs.stat(bboxUri);
		} catch {
			return [new CreateNewBoxItem(imageUri)];
		}
		try {
			const buf = await vscode.workspace.fs.readFile(bboxUri);
			content = new TextDecoder().decode(buf);
		} catch {
			return [new CreateNewBoxItem(imageUri)];
		}

		const settings = getSettings();
		const items: BboxSectionTreeItem[] = [new CreateNewBoxItem(imageUri)];

		if (settings.bboxFormat === 'yolo') {
			const lines = content.trim().split(/\r?\n/).filter(Boolean);
			for (let i = 0; i < lines.length; i++) {
				items.push(new BoxTreeItem(imageUri, i, `Box ${i + 1}`));
			}
		} else {
			const boxes: Bbox[] = parseBbox(content, settings.bboxFormat, 0, 0);
			for (let i = 0; i < boxes.length; i++) {
				const b = boxes[i];
				const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
				items.push(new BoxTreeItem(imageUri, i, label));
			}
		}

		return items;
	}
}

export { CREATE_NEW_BBOX_COMMAND, OPEN_IMAGE_WITH_BOX_COMMAND };
