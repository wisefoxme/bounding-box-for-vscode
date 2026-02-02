import * as vscode from 'vscode';
import { registerExplorer } from './explorer';
import { BoundingBoxEditorProvider } from './editorProvider';
import { BboxSectionTreeDataProvider } from './bboxSection';
import {
	setSelectedImageUri,
	getSelectedImageUri,
	setSelectedBoxIndices,
	getSelectedBoxIndices,
} from './selectedImage';
import { getBboxUriForImage, getSettings } from './settings';
import { getProviderForImage, getProvider } from './formatProviders';
import type { Bbox } from './bbox';
import {
	ProjectTreeItem,
	BoundingBoxesGroupItem,
	BoxTreeItem,
} from './explorer';

const HAS_BOX_SELECTED_CONTEXT = 'boundingBoxEditor.hasBoxSelected';
const BBOX_SECTION_BOX_SELECTED_CONTEXT = 'boundingBoxEditor.bboxSectionBoxSelected';
const BBOX_SECTION_MULTIPLE_BOXES_SELECTED_CONTEXT = 'boundingBoxEditor.bboxSectionMultipleBoxesSelected';

export function activate(context: vscode.ExtensionContext) {
	const dimensionsByImageUri = new Map<string, { width: number; height: number }>();
	const getDimensions = (uri: vscode.Uri): { width: number; height: number } | undefined =>
		dimensionsByImageUri.get(uri.toString());

	const bboxSectionProvider = new BboxSectionTreeDataProvider({ getDimensions });
	const editorSelectionByUri = new Map<string, number[]>();

	const { provider: projectProvider, treeView: projectTreeView } = registerExplorer(
		context,
		(imageUri) => {
			setSelectedImageUri(imageUri);
			bboxSectionProvider.refresh();
		},
		() => bboxSectionProvider.refresh(),
		getDimensions,
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
		onDimensionsReceived: (imageUri: vscode.Uri, width: number, height: number) => {
			if (width > 0 && height > 0) {
				dimensionsByImageUri.set(imageUri.toString(), { width, height });
			} else {
				dimensionsByImageUri.delete(imageUri.toString());
			}
		},
		onEditorOpened: (imageUri: vscode.Uri) => {
			setSelectedImageUri(imageUri);
			bboxSectionProvider.refresh();
		},
		onSelectionChanged: (imageUri: vscode.Uri, selectedBoxIndices: number[]) => {
			setSelectedBoxIndices(selectedBoxIndices);
			editorSelectionByUri.set(imageUri.toString(), selectedBoxIndices);
			const isSelectedImage = getSelectedImageUri()?.toString() === imageUri.toString();
			if (isSelectedImage) {
				void vscode.commands.executeCommand('setContext', BBOX_SECTION_BOX_SELECTED_CONTEXT, selectedBoxIndices.length >= 1);
				void vscode.commands.executeCommand('setContext', BBOX_SECTION_MULTIPLE_BOXES_SELECTED_CONTEXT, selectedBoxIndices.length > 1);
			}
			bboxSectionProvider.refresh();
			if (selectedBoxIndices.length > 0) {
				void revealBoxInProjectTree(imageUri, selectedBoxIndices[0]);
			}
		},
		onEditorViewStateChange: (imageUri: vscode.Uri, active: boolean) => {
			const indices = active ? editorSelectionByUri.get(imageUri.toString()) : undefined;
			void vscode.commands.executeCommand(
				'setContext',
				HAS_BOX_SELECTED_CONTEXT,
				active && indices !== undefined && indices.length > 0,
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

	bboxSectionTreeView.onDidChangeSelection(() => {
		const boxItems = bboxSectionTreeView.selection.filter((s): s is BoxTreeItem => s instanceof BoxTreeItem);
		const hasSelection = boxItems.length >= 1;
		const multiple = boxItems.length > 1;
		void vscode.commands.executeCommand('setContext', BBOX_SECTION_BOX_SELECTED_CONTEXT, hasSelection);
		void vscode.commands.executeCommand('setContext', BBOX_SECTION_MULTIPLE_BOXES_SELECTED_CONTEXT, multiple);
		setSelectedBoxIndices(boxItems.length > 0 ? boxItems.map((b) => b.bboxIndex) : []);
		bboxSectionProvider.refresh();
	});
	void vscode.commands.executeCommand('setContext', BBOX_SECTION_BOX_SELECTED_CONTEXT, false);
	void vscode.commands.executeCommand('setContext', BBOX_SECTION_MULTIPLE_BOXES_SELECTED_CONTEXT, false);

	function getBoxTreeItemsFromSelection(): { imageUri: vscode.Uri; indices: number[] } | undefined {
		const boxItems = bboxSectionTreeView.selection.filter((s): s is BoxTreeItem => s instanceof BoxTreeItem);
		if (boxItems.length > 0) {
			const imageUri = boxItems[0].imageUri;
			const indices = boxItems.map((b) => b.bboxIndex);
			return { imageUri, indices };
		}
		const proj = projectTreeView.selection[0];
		if (proj instanceof BoxTreeItem) {
			return { imageUri: proj.imageUri, indices: [proj.bboxIndex] };
		}
		return undefined;
	}

	function getImageUriForRemoveAllBoxes(): vscode.Uri | undefined {
		const sel = projectTreeView.selection[0];
		if (sel instanceof ProjectTreeItem) {return sel.bboxUri ? sel.imageUri : undefined;}
		if (sel instanceof BoundingBoxesGroupItem) {return sel.imageUri;}
		return undefined;
	}

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

	async function removeSelectedBoxes(): Promise<void> {
		let imageUri: vscode.Uri | undefined;
		let indices: number[];
		const fromTree = getBoxTreeItemsFromSelection();
		if (fromTree) {
			imageUri = fromTree.imageUri;
			indices = fromTree.indices;
		} else {
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			imageUri = input?.resource;
			const editorIndices = imageUri ? editorSelectionByUri.get(imageUri.toString()) : undefined;
			indices = editorIndices ?? [];
		}
		if (!imageUri || indices.length === 0) {return;}
		const folder = vscode.workspace.getWorkspaceFolder(imageUri);
		if (!folder) {return;}
		const settings = getSettings();
		const provider = getProviderForImage(imageUri) ?? getProvider(settings.bboxFormat);
		if (!provider) {return;}
		if (provider.id === 'yolo' && !editorProvider.hasEditorOpen(imageUri)) {
			void vscode.window.showInformationMessage(
				'Open the image in the Bounding Box Editor to remove boxes (YOLO format requires image dimensions).',
			);
			return;
		}
		if (editorProvider.hasEditorOpen(imageUri)) {
			editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: indices });
			return;
		}
		const bboxUri = getBboxUriForImage(folder, imageUri);
		let content: string;
		try {
			content = new TextDecoder().decode(await vscode.workspace.fs.readFile(bboxUri));
		} catch {
			return;
		}
		const boxes = provider.parse(content, 0, 0);
		const sortedIndices = [...indices].sort((a, b) => b - a).filter((i) => i >= 0 && i < boxes.length);
		for (const i of sortedIndices) {
			boxes.splice(i, 1);
		}
		const serialized = provider.serialize(boxes, 0, 0);
		await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode(serialized));
		refreshTrees();
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.removeBox', removeSelectedBoxes),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.removeSelectedBoxes', removeSelectedBoxes),
	);

	async function doRenameBox(imageUri: vscode.Uri, bboxIndex: number): Promise<void> {
		try {
			const folder = vscode.workspace.getWorkspaceFolder(imageUri);
			if (!folder) {
				void vscode.window.showErrorMessage('Failed to rename bounding box: Image is not in a workspace folder.');
				return;
			}
			const bboxUri = getBboxUriForImage(folder, imageUri);
			const settings = getSettings();
			const provider = getProviderForImage(imageUri) ?? getProvider(settings.bboxFormat);
			if (!provider) {
				void vscode.window.showErrorMessage('Failed to rename bounding box: No format provider available.');
				return;
			}
			let currentLabel = `Box ${bboxIndex + 1}`;
			if (provider.id !== 'yolo') {
				try {
					const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(bboxUri));
					const boxes = provider.parse(content, 0, 0);
					if (bboxIndex >= 0 && bboxIndex < boxes.length) {
						currentLabel = boxes[bboxIndex].label ?? currentLabel;
					}
				} catch {
					// use default label
				}
			}
			const newLabel = await vscode.window.showInputBox({
				title: 'Rename bounding box',
				value: currentLabel,
				prompt: 'Enter new label for the box',
			});
			if (newLabel === undefined) {return;}
			if (provider.id === 'yolo' && editorProvider.hasEditorOpen(imageUri)) {
				editorProvider.postMessageToEditor(imageUri, { type: 'renameBoxAt', bboxIndex, label: newLabel });
				refreshTrees();
				return;
			}
			if (provider.id === 'yolo') {
				void vscode.window.showInformationMessage(
					'Open the image in the Bounding Box Editor to rename boxes (YOLO format).',
				);
				return;
			}
			let content: string;
			try {
				content = new TextDecoder().decode(await vscode.workspace.fs.readFile(bboxUri));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				void vscode.window.showErrorMessage(`Failed to rename bounding box: Could not read bbox file. ${msg}`);
				return;
			}
			const boxes = provider.parse(content, 0, 0);
			if (bboxIndex < 0 || bboxIndex >= boxes.length) {
				void vscode.window.showErrorMessage(`Failed to rename bounding box: Invalid box index (${bboxIndex}).`);
				return;
			}
			boxes[bboxIndex] = { ...boxes[bboxIndex], label: newLabel };
			const serialized = provider.serialize(boxes, 0, 0);
			try {
				await vscode.workspace.fs.writeFile(bboxUri, new TextEncoder().encode(serialized));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				void vscode.window.showErrorMessage(`Failed to rename bounding box: Could not write bbox file. ${msg}`);
				return;
			}
			refreshTrees();
			editorProvider.postMessageToEditor(imageUri, { type: 'boxes', boxes });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`Failed to rename bounding box: ${msg}`);
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.renameBox', async () => {
			const fromTree = getBoxTreeItemsFromSelection();
			if (fromTree && fromTree.indices.length === 1) {
				await doRenameBox(fromTree.imageUri, fromTree.indices[0]);
				return;
			}
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			const imageUri = input?.resource;
			if (!imageUri) {return;}
			const indices = editorSelectionByUri.get(imageUri.toString());
			if (!indices || indices.length !== 1) {return;}
			await doRenameBox(imageUri, indices[0]);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.renameBoundingBox', async () => {
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			const imageUri = input?.resource;
			if (!imageUri) {return;}
			const indices = editorSelectionByUri.get(imageUri.toString());
			if (!indices || indices.length !== 1) {return;}
			await doRenameBox(imageUri, indices[0]);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.removeBoundingBox', async () => {
			const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
			const imageUri = input?.resource;
			if (!imageUri) {return;}
			const indices = editorSelectionByUri.get(imageUri.toString());
			if (!indices || indices.length === 0) {return;}
			editorProvider.postMessageToEditor(imageUri, { type: 'removeBoxAtIndices', bboxIndices: indices });
			editorSelectionByUri.set(imageUri.toString(), []);
			void vscode.commands.executeCommand('setContext', HAS_BOX_SELECTED_CONTEXT, false);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('bounding-box-editor.revealBboxFile', async (node?: BoxTreeItem | unknown) => {
			let imageUri: vscode.Uri | undefined;
			if (node instanceof BoxTreeItem) {
				imageUri = node.imageUri;
			} else {
				const fromTree = getBoxTreeItemsFromSelection();
				if (fromTree && fromTree.indices.length >= 1) {
					imageUri = fromTree.imageUri;
				} else {
					const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
					const input = activeTab?.input as { resource?: vscode.Uri } | undefined;
					const uri = input?.resource;
					const indices = uri ? editorSelectionByUri.get(uri.toString()) : undefined;
					if (uri && indices && indices.length === 1) {
						imageUri = uri;
					}
				}
			}
			if (!imageUri) {return;}
			const folder = vscode.workspace.getWorkspaceFolder(imageUri);
			if (!folder) {return;}
			const bboxUri = getBboxUriForImage(folder, imageUri);
			try {
				await vscode.workspace.fs.stat(bboxUri);
			} catch {
				void vscode.window.showInformationMessage('No bounding box file found for this image.');
				return;
			}
			try {
				await vscode.commands.executeCommand('revealInExplorer', bboxUri);
			} catch {
				await vscode.window.showTextDocument(bboxUri);
				await vscode.commands.executeCommand('revealInExplorer');
			}
		}),
	);

	const disposable = vscode.commands.registerCommand('bounding-box-editor.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from bounding-box-editor!');
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
