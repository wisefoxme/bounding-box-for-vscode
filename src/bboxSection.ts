import * as vscode from 'vscode';
import type { Bbox } from './bbox';
import { getBboxCandidateUris, getSettings, readMergedBboxContent } from './settings';
import { getSelectedImageUri, getSelectedBoxIndices } from './selectedImage';
import { BoxTreeItem } from './explorer';

const OPEN_IMAGE_WITH_BOX_COMMAND = 'bounding-box-editor.openImageWithBox';

export class BboxSectionPlaceholderItem extends vscode.TreeItem {
	constructor(message = 'Select an image from Project') {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'placeholder';
	}
}

export type BboxSectionTreeItem = BoxTreeItem | BboxSectionPlaceholderItem;

export type GetDimensions = (uri: vscode.Uri) => { width: number; height: number } | undefined;

export type GetLiveBoxes = (imageUri: vscode.Uri) => Bbox[] | undefined;

/** Optional: resolve selected image URI to the editor's document URI so live-box lookup matches. */
export type ResolveImageUri = (uri: vscode.Uri) => vscode.Uri | undefined;

export class BboxSectionTreeDataProvider implements vscode.TreeDataProvider<BboxSectionTreeItem> {
	private readonly _getDimensions?: GetDimensions;
	private readonly _getLiveBoxes?: GetLiveBoxes;
	private readonly _resolveImageUri?: ResolveImageUri;
	private _onDidChangeTreeData = new vscode.EventEmitter<BboxSectionTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(options?: {
		getDimensions?: GetDimensions;
		getLiveBoxes?: GetLiveBoxes;
		resolveImageUri?: ResolveImageUri;
	}) {
		this._getDimensions = options?.getDimensions;
		this._getLiveBoxes = options?.getLiveBoxes;
		this._resolveImageUri = options?.resolveImageUri;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: BboxSectionTreeItem): vscode.TreeItem {
		return element;
	}

	getParent(element: BboxSectionTreeItem): undefined {
		return undefined;
	}

	async getChildren(element?: BboxSectionTreeItem): Promise<BboxSectionTreeItem[]> {
		if (element !== undefined) {
			return [];
		}

		const imageUri = getSelectedImageUri();
		if (!imageUri) {
			return [new BboxSectionPlaceholderItem()];
		}

		const folder = vscode.workspace.getWorkspaceFolder(imageUri);
		if (!folder) {
			return [new BboxSectionPlaceholderItem('Open the image and draw on the canvas to add boxes')];
		}

		const lookupUri = this._resolveImageUri?.(imageUri) ?? imageUri;
		const liveBoxes = this._getLiveBoxes?.(lookupUri);
		let boxes: Bbox[];
		if (Array.isArray(liveBoxes)) {
			boxes = liveBoxes;
		} else {
			const candidates = await getBboxCandidateUris(folder, imageUri);
			if (candidates.length === 0) {
				return [new BboxSectionPlaceholderItem('Open the image and draw on the canvas to add boxes')];
			}
			const merged = await readMergedBboxContent(folder, imageUri, undefined, this._getDimensions?.(imageUri));
			boxes = merged.boxes;
		}
		const selectedIndices = getSelectedBoxIndices();
		const settings = getSettings();

		if (settings.bboxFormat === 'yolo') {
			return boxes.map((b, i) => {
				const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
				const description = `x:${Math.round(b.x_min)} y:${Math.round(b.y_min)} w:${Math.round(b.width)} h:${Math.round(b.height)}`;
				return new BoxTreeItem(imageUri, i, label, {
					description,
					selected: selectedIndices.includes(i),
				});
			});
		}
		return boxes.map((b, i) => {
			const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
			const description = `x:${Math.round(b.x_min)} y:${Math.round(b.y_min)} w:${Math.round(b.width)} h:${Math.round(b.height)}`;
			return new BoxTreeItem(imageUri, i, label, {
				description,
				selected: selectedIndices.includes(i),
			});
		});
	}
}

export { OPEN_IMAGE_WITH_BOX_COMMAND };
