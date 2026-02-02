import * as vscode from 'vscode';
import { getImageDirUri, getBboxUriForImage, getBboxCandidateUris, onSettingsChanged, getSettings, readMergedBboxContent } from './settings';
import { setSelectedBoxIndex, getSelectedBoxIndices } from './selectedImage';

const IMAGE_GLOB = '**/*.{png,jpg,jpeg,gif,webp}';

const OPEN_IMAGE_WITH_BOX_COMMAND = 'bounding-box-editor.openImageWithBox';
const SELECTED_BOX_STATE_PREFIX = 'selectedBoxIndex_';

export class ProjectTreeItem extends vscode.TreeItem {
	constructor(
		public readonly imageUri: vscode.Uri,
		public readonly bboxUri: vscode.Uri | undefined,
		public readonly workspaceFolder: vscode.WorkspaceFolder,
	) {
		const collapsible =
			bboxUri !== undefined
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None;
		super(imageUri, collapsible);
		this.contextValue = bboxUri ? 'imageWithBbox' : 'imageOnly';
		this.tooltip = imageUri.fsPath + (bboxUri ? `\nBbox: ${bboxUri.fsPath}` : '\nNo bbox file');
		this.iconPath = new vscode.ThemeIcon('file-media');
		this.command = {
			command: 'vscode.openWith',
			title: 'Open',
			arguments: [imageUri, 'boundingBoxEditor.imageEditor'],
		};
	}
}

export class BoundingBoxesGroupItem extends vscode.TreeItem {
	constructor(
		public readonly imageUri: vscode.Uri,
		public readonly bboxUri: vscode.Uri,
		public readonly workspaceFolder: vscode.WorkspaceFolder,
		public readonly parent?: ProjectTreeItem,
	) {
		super('Bounding boxes', vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = 'bboxGroup';
		this.iconPath = new vscode.ThemeIcon('symbol-misc');
	}
}

export class BoxTreeItem extends vscode.TreeItem {
	constructor(
		public readonly imageUri: vscode.Uri,
		public readonly bboxIndex: number,
		label: string,
		options?: { description?: string; selected?: boolean; parent?: BoundingBoxesGroupItem },
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'bboxItem';
		this.iconPath = new vscode.ThemeIcon('symbol-numeric', new vscode.ThemeColor('symbolIcon.variableForeground'));
		this.command = {
			command: OPEN_IMAGE_WITH_BOX_COMMAND,
			title: 'Open and select box',
			arguments: [imageUri, bboxIndex],
		};
		if (options?.description !== undefined) {
			this.description = options.description;
		}
		if (options?.selected) {
			this.description = (this.description ? this.description + ' ' : '') + '(selected)';
		}
		this._parent = options?.parent;
	}
	readonly _parent: BoundingBoxesGroupItem | undefined;
}

export type ExplorerTreeItem = ProjectTreeItem | BoundingBoxesGroupItem | BoxTreeItem;

function isProjectTreeItem(el: ExplorerTreeItem): el is ProjectTreeItem {
	return el instanceof ProjectTreeItem;
}

function isBoundingBoxesGroupItem(el: ExplorerTreeItem): el is BoundingBoxesGroupItem {
	return el instanceof BoundingBoxesGroupItem;
}

export type GetDimensions = (uri: vscode.Uri) => { width: number; height: number } | undefined;

export class ProjectTreeDataProvider implements vscode.TreeDataProvider<ExplorerTreeItem> {
	private readonly _getDimensions?: GetDimensions;
	private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(options?: { getDimensions?: GetDimensions }) {
		this._getDimensions = options?.getDimensions;
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ExplorerTreeItem): vscode.TreeItem {
		return element;
	}

	getParent(element: ExplorerTreeItem): ExplorerTreeItem | undefined {
		if (element instanceof BoundingBoxesGroupItem) {
			return element.parent;
		}
		if (element instanceof BoxTreeItem) {
			return element._parent;
		}
		return undefined;
	}

	async getChildren(element?: ExplorerTreeItem): Promise<ExplorerTreeItem[]> {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length === 0) {
			return [];
		}

		if (element === undefined) {
			const items: ProjectTreeItem[] = [];
			for (const folder of folders) {
				const imageDir = getImageDirUri(folder);
				const pattern = new vscode.RelativePattern(imageDir, IMAGE_GLOB);
				const imageUris = await vscode.workspace.findFiles(pattern, null, 1000);
				for (const imageUri of imageUris) {
					const candidates = await getBboxCandidateUris(folder, imageUri);
					let primary: vscode.Uri | undefined;
					for (const u of candidates) {
						try {
							await vscode.workspace.fs.stat(u);
							primary = u;
							break;
						} catch {
							// continue
						}
					}
					items.push(new ProjectTreeItem(imageUri, primary, folder));
				}
			}
			return items.sort((a, b) => a.imageUri.fsPath.localeCompare(b.imageUri.fsPath));
		}

		if (isProjectTreeItem(element)) {
			if (element.bboxUri === undefined) {
				return [];
			}
			return [new BoundingBoxesGroupItem(element.imageUri, element.bboxUri, element.workspaceFolder, element)];
		}

		if (isBoundingBoxesGroupItem(element)) {
			const merged = await readMergedBboxContent(
				element.workspaceFolder,
				element.imageUri,
				undefined,
				this._getDimensions?.(element.imageUri),
			);
			const boxes = merged.boxes;
			const selectedIndices = getSelectedBoxIndices();
			if (getSettings().bboxFormat === 'yolo') {
				return boxes.map((b, i) => {
					const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
					const description = `x:${Math.round(b.x_min)} y:${Math.round(b.y_min)} w:${Math.round(b.width)} h:${Math.round(b.height)}`;
					return new BoxTreeItem(element.imageUri, i, label, {
						description,
						selected: selectedIndices.includes(i),
						parent: element,
					});
				});
			}
			return boxes.map((b, i) => {
				const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
				const description = `x:${Math.round(b.x_min)} y:${Math.round(b.y_min)} w:${Math.round(b.width)} h:${Math.round(b.height)}`;
				return new BoxTreeItem(element.imageUri, i, label, {
					description,
					selected: selectedIndices.includes(i),
					parent: element,
				});
			});
		}

		return [];
	}
}

export function registerExplorer(
	context: vscode.ExtensionContext,
	onSelectionChange?: (imageUri: vscode.Uri | undefined) => void,
	refreshBboxSection?: () => void,
	getDimensions?: GetDimensions,
): { provider: ProjectTreeDataProvider; treeView: vscode.TreeView<ExplorerTreeItem> } {
	const provider = new ProjectTreeDataProvider({ getDimensions });
	const treeView = vscode.window.createTreeView('boundingBoxEditor.projectView', { treeDataProvider: provider });
	context.subscriptions.push(treeView);

	if (onSelectionChange) {
		context.subscriptions.push(
			treeView.onDidChangeSelection((e) => {
				const sel = e.selection[0];
				if (!sel) {
					onSelectionChange(undefined);
					return;
				}
				if (sel instanceof ProjectTreeItem) {
					if (sel.bboxUri) {
						setTimeout(() => {
							void treeView.reveal(sel, { expand: 2 });
						}, 0);
					}
					onSelectionChange(sel.imageUri);
				} else if (sel instanceof BoundingBoxesGroupItem) {
					onSelectionChange(sel.imageUri);
				} else if (sel instanceof BoxTreeItem) {
					onSelectionChange(sel.imageUri);
				} else {
					onSelectionChange(undefined);
				}
			}),
		);
	}

	context.subscriptions.push(onSettingsChanged(() => provider.refresh()));

	context.subscriptions.push(
		vscode.commands.registerCommand(OPEN_IMAGE_WITH_BOX_COMMAND, (imageUri: vscode.Uri, bboxIndex: number) => {
			const key = SELECTED_BOX_STATE_PREFIX + imageUri.toString();
			context.workspaceState.update(key, bboxIndex);
			setSelectedBoxIndex(bboxIndex);
			refreshBboxSection?.();
			void vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor');
		}),
	);

	return { provider, treeView };
}

export { OPEN_IMAGE_WITH_BOX_COMMAND, SELECTED_BOX_STATE_PREFIX };
