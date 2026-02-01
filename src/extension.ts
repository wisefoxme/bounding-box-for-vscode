import * as vscode from 'vscode';
import { registerExplorer } from './explorer';
import {
	BoundingBoxEditorProvider,
	ADD_BOX_ON_OPEN_PREFIX,
} from './editorProvider';
import {
	BboxSectionTreeDataProvider,
	CREATE_NEW_BBOX_COMMAND,
} from './bboxSection';
import {
	setSelectedImageUri,
	getSelectedImageUri,
	setSelectedBoxIndex,
	getSelectedBoxIndex,
} from './selectedImage';
import { getBboxUriForImage, getSettings } from './settings';
import { parseBbox, serializeBbox } from './bbox';
import type { Bbox } from './bbox';
import {
	ProjectTreeItem,
	BoundingBoxesGroupItem,
	BoxTreeItem,
} from './explorer';

const HAS_BOX_SELECTED_CONTEXT = 'boundingBoxEditor.hasBoxSelected';

export function activate(context: vscode.ExtensionContext) {
	const bboxSectionProvider = new BboxSectionTreeDataProvider();
	const editorSelectionByUri = new Map<string, number | undefined>();

	const { provider: projectProvider, treeView: projectTreeView } = registerExplorer(
		context,
		(imageUri) => {
			setSelectedImageUri(imageUri);
			bboxSectionProvider.refresh();
		},
		() => bboxSectionProvider.refresh(),
	);

	const refreshTrees = (): void => {
		projectProvider.refresh();
		bboxSectionProvider.refresh();
	};

	async function revealBoxInProjectTree(imageUri: vscode.Uri, selectedBoxIndex: number): Promise<void> {
		const rootItems = await projectProvider.getChildren(undefined);
		const projectItem = rootItems.find(
			(el): el is ProjectTreeItem => el instanceof ProjectTreeItem && el.imageUri.toString() === imageUri.toString(),
		);
		if (!projectItem?.bboxUri) {return;}
		const groupItems = await projectProvider.getChildren(projectItem);
		const groupItem = groupItems[0];
		if (!(groupItem instanceof BoundingBoxesGroupItem)) {return;}
		const boxItems = await projectProvider.getChildren(groupItem);
		const boxItem = boxItems[selectedBoxIndex];
		if (boxItem instanceof BoxTreeItem) {
			void projectTreeView.reveal(boxItem);
		}
	}

	const editorProvider = new BoundingBoxEditorProvider(context, {
		onBboxSaved: refreshTrees,
		onEditorOpened: (imageUri: vscode.Uri) => {
			setSelectedImageUri(imageUri);
			bboxSectionProvider.refresh();
		},
		onSelectionChanged: (imageUri: vscode.Uri, selectedBoxIndex: number | undefined) => {
			setSelectedBoxIndex(selectedBoxIndex);
			bboxSectionProvider.refresh();
			editorSelectionByUri.set(imageUri.toString(), selectedBoxIndex);
			if (selectedBoxIndex !== undefined && selectedBoxIndex >= 0) {
				void revealBoxInProjectTree(imageUri, selectedBoxIndex);
			}
		},
		onEditorViewStateChange: (imageUri: vscode.Uri, active: boolean) => {
			const idx = active ? editorSelectionByUri.get(imageUri.toString()) : undefined;
			void vscode.commands.executeCommand(
				'setContext',
				HAS_BOX_SELECTED_CONTEXT,
				active && idx !== undefined && idx >= 0,
			);
		},
	});

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			'boundingBoxEditor.imageEditor',
			editorProvider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);

	const bboxSectionTreeView = vscode.window.createTreeView('boundingBoxEditor.bboxSectionView', {
		treeDataProvider: bboxSectionProvider,
	});
	context.subscriptions.push(bboxSectionTreeView);

	function getBoxTreeItemFromSelection(): BoxTreeItem | undefined {
		const proj = projectTreeView.selection[0];
		if (proj instanceof BoxTreeItem) {return proj;}
		const bbox = bboxSectionTreeView.selection[0];
		if (bbox instanceof BoxTreeItem) {return bbox;}
		return undefined;
	}

	function getImageUriForRemoveAllBoxes(): vscode.Uri | undefined {
		const sel = projectTreeView.selection[0];
		if (sel instanceof ProjectTreeItem) {return sel.bboxUri ? sel.imageUri : undefined;}
		if (sel instanceof BoundingBoxesGroupItem) {return sel.imageUri;}
		return undefined;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(CREATE_NEW_BBOX_COMMAND, async (imageUriArg?: vscode.Uri) => {
			const imageUri = imageUriArg ?? getSelectedImageUri();
			if (!imageUri) {
				void vscode.window.showInformationMessage(
					'Select an image from the Project section first, or open an image in the Bounding Box Editor.',
				);
				return;
			}
			const folder = vscode.workspace.getWorkspaceFolder(imageUri);
			if (!folder) {return;}
			const bboxUri = getBboxUriForImage(folder, imageUri);
			try {
				await vscode.workspace.fs.stat(bboxUri);
			} catch {
				await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode(''));
			}
			context.workspaceState.update(ADD_BOX_ON_OPEN_PREFIX + imageUri.toString(), true as boolean);
			await vscode.commands.executeCommand('vscode.openWith', imageUri, 'boundingBoxEditor.imageEditor');
			projectProvider.refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.removeAllBoxes', async () => {
			const imageUri = getImageUriForRemoveAllBoxes();
			if (!imageUri) {return;}
			const folder = vscode.workspace.getWorkspaceFolder(imageUri);
			if (!folder) {return;}
			const bboxUri = getBboxUriForImage(folder, imageUri);
			await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode(''));
			refreshTrees();
			editorProvider.postMessageToEditor(imageUri, { type: 'boxes', boxes: [] });
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.removeBox', async () => {
			const boxItem = getBoxTreeItemFromSelection();
			if (!boxItem) {return;}
			const { imageUri, bboxIndex } = boxItem;
			const folder = vscode.workspace.getWorkspaceFolder(imageUri);
			if (!folder) {return;}
			const bboxUri = getBboxUriForImage(folder, imageUri);
			let content: string;
			try {
				content = new TextDecoder().decode(await vscode.workspace.fs.readFile(bboxUri));
			} catch {
				return;
			}
			const settings = getSettings();
			const boxes = parseBbox(content, settings.bboxFormat, 0, 0);
			if (bboxIndex < 0 || bboxIndex >= boxes.length) {return;}
			if (settings.bboxFormat === 'yolo' && !editorProvider.hasEditorOpen(imageUri)) {
				void vscode.window.showInformationMessage(
					'Open the image in the Bounding Box Editor to remove boxes (YOLO format requires image dimensions).',
				);
				return;
			}
			boxes.splice(bboxIndex, 1);
			if (settings.bboxFormat !== 'yolo') {
				const serialized = serializeBbox(boxes, settings.bboxFormat, 0, 0);
				await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode(serialized));
				refreshTrees();
			}
			editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAt', bboxIndex });
		}),
	);

	async function doRenameBox(imageUri: vscode.Uri, bboxIndex: number): Promise<void> {
		const folder = vscode.workspace.getWorkspaceFolder(imageUri);
		if (!folder) {return;}
		const bboxUri = getBboxUriForImage(folder, imageUri);
		const settings = getSettings();
		let currentLabel = `Box ${bboxIndex + 1}`;
		if (settings.bboxFormat !== 'yolo') {
			try {
				const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(bboxUri));
				const boxes = parseBbox(content, settings.bboxFormat, 0, 0);
				if (bboxIndex >= 0 && bboxIndex < boxes.length) {
					currentLabel = boxes[bboxIndex].label ?? currentLabel;
				}
			} catch {
				// use default label
			}
		} else if (editorProvider.hasEditorOpen(imageUri)) {
			// YOLO: get current label from webview would require another message; use default
		}
		const newLabel = await vscode.window.showInputBox({
			title: 'Rename bounding box',
			value: currentLabel,
			prompt: 'Enter new label for the box',
		});
		if (newLabel === undefined) {return;}
		if (settings.bboxFormat === 'yolo' && editorProvider.hasEditorOpen(imageUri)) {
			editorProvider.postMessageToEditor(imageUri, { type: 'renameBoxAt', bboxIndex, label: newLabel });
			refreshTrees();
			return;
		}
		if (settings.bboxFormat === 'yolo') {
			void vscode.window.showInformationMessage(
				'Open the image in the Bounding Box Editor to rename boxes (YOLO format).',
			);
			return;
		}
		let content: string;
		try {
			content = new TextDecoder().decode(await vscode.workspace.fs.readFile(bboxUri));
		} catch {
			return;
		}
		const boxes = parseBbox(content, settings.bboxFormat, 0, 0);
		if (bboxIndex < 0 || bboxIndex >= boxes.length) {return;}
		boxes[bboxIndex] = { ...boxes[bboxIndex], label: newLabel };
		const serialized = serializeBbox(boxes, settings.bboxFormat, 0, 0);
		await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode(serialized));
		refreshTrees();
		editorProvider.postMessageToEditor(imageUri, { type: 'boxes', boxes });
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.renameBox', async () => {
			const boxItem = getBoxTreeItemFromSelection();
			if (boxItem) {
				await doRenameBox(boxItem.imageUri, boxItem.bboxIndex);
				return;
			}
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			const imageUri = input?.resource;
			if (!imageUri) {return;}
			const idx = editorSelectionByUri.get(imageUri.toString());
			if (idx === undefined || idx < 0) {return;}
			await doRenameBox(imageUri, idx);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.renameBoundingBox', async () => {
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			const imageUri = input?.resource;
			if (!imageUri) {return;}
			const idx = editorSelectionByUri.get(imageUri.toString());
			if (idx === undefined || idx < 0) {return;}
			await doRenameBox(imageUri, idx);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.removeBoundingBox', async () => {
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			const imageUri = input?.resource;
			if (!imageUri) {return;}
			const idx = editorSelectionByUri.get(imageUri.toString());
			if (idx === undefined || idx < 0) {return;}
			editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAt', bboxIndex: idx });
			editorSelectionByUri.set(imageUri.toString(), undefined);
			void vscode.commands.executeCommand('setContext', HAS_BOX_SELECTED_CONTEXT, false);
		}),
	);

	const disposable = vscode.commands.registerCommand('bounding-box-editor.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from bounding-box-editor!');
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
