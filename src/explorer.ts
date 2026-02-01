import * as vscode from 'vscode';
import { getImageDirUri, getBboxDirUri, getBboxExtension, onSettingsChanged, getSettings } from './settings';
import { parseBbox } from './bbox';
import type { Bbox } from './bbox';

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
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'bboxItem';
		this.iconPath = new vscode.ThemeIcon('symbol-numeric', new vscode.ThemeColor('symbolIcon.variableForeground'));
		this.command = {
			command: OPEN_IMAGE_WITH_BOX_COMMAND,
			title: 'Open and select box',
			arguments: [imageUri, bboxIndex],
		};
	}
}

export type ExplorerTreeItem = ProjectTreeItem | BoundingBoxesGroupItem | BoxTreeItem;

function isProjectTreeItem(el: ExplorerTreeItem): el is ProjectTreeItem {
	return el instanceof ProjectTreeItem;
}

function isBoundingBoxesGroupItem(el: ExplorerTreeItem): el is BoundingBoxesGroupItem {
	return el instanceof BoundingBoxesGroupItem;
}

export class ProjectTreeDataProvider implements vscode.TreeDataProvider<ExplorerTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ExplorerTreeItem): vscode.TreeItem {
		return element;
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
				const bboxDir = getBboxDirUri(folder);
				const pattern = new vscode.RelativePattern(imageDir, IMAGE_GLOB);
				const imageUris = await vscode.workspace.findFiles(pattern, null, 1000);
				for (const imageUri of imageUris) {
					const base = imageUri.path.replace(/\.[^/.]+$/, '');
					const baseName = base.split('/').pop() ?? '';
					const bboxPath = `${baseName}${getBboxExtension()}`;
					const bboxUri = vscode.Uri.joinPath(bboxDir, bboxPath);
					let bboxExists: boolean;
					try {
						await vscode.workspace.fs.stat(bboxUri);
						bboxExists = true;
					} catch {
						bboxExists = false;
					}
					items.push(new ProjectTreeItem(imageUri, bboxExists ? bboxUri : undefined, folder));
				}
			}
			return items.sort((a, b) => a.imageUri.fsPath.localeCompare(b.imageUri.fsPath));
		}

		if (isProjectTreeItem(element)) {
			if (element.bboxUri === undefined) {
				return [];
			}
			return [new BoundingBoxesGroupItem(element.imageUri, element.bboxUri, element.workspaceFolder)];
		}

		if (isBoundingBoxesGroupItem(element)) {
			let content: string;
			try {
				const buf = await vscode.workspace.fs.readFile(element.bboxUri);
				content = new TextDecoder().decode(buf);
			} catch {
				return [];
			}
			const settings = getSettings();
			let boxes: Bbox[];
			if (settings.bboxFormat === 'yolo') {
				const lines = content.trim().split(/\r?\n/).filter(Boolean);
				return lines.map(
					(_, i) => new BoxTreeItem(element.imageUri, i, `Box ${i + 1}`),
				);
			}
			boxes = parseBbox(content, settings.bboxFormat, 0, 0);
			return boxes.map((b, i) => {
				const label = b.label !== undefined && b.label !== '' ? b.label : `Box ${i + 1}`;
				return new BoxTreeItem(element.imageUri, i, label);
			});
		}

		return [];
	}
}

export function registerExplorer(
	context: vscode.ExtensionContext,
	onSelectionChange?: (imageUri: vscode.Uri | undefined) => void,
): { provider: ProjectTreeDataProvider; treeView: vscode.TreeView<ExplorerTreeItem> } {
	const provider = new ProjectTreeDataProvider();
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
			vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor');
		}),
	);

	return { provider, treeView };
}

export { OPEN_IMAGE_WITH_BOX_COMMAND, SELECTED_BOX_STATE_PREFIX };
