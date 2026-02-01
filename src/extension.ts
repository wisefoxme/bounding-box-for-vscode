import * as vscode from 'vscode';
import { registerExplorer } from './explorer';
import { BoundingBoxEditorProvider, ADD_BOX_ON_OPEN_PREFIX } from './editorProvider';
import { BboxSectionTreeDataProvider, CREATE_NEW_BBOX_COMMAND } from './bboxSection';
import { setSelectedImageUri, getSelectedImageUri } from './selectedImage';
import { getBboxUriForImage } from './settings';

export function activate(context: vscode.ExtensionContext) {
	const bboxSectionProvider = new BboxSectionTreeDataProvider();

	const { provider: projectProvider } = registerExplorer(context, (imageUri) => {
		setSelectedImageUri(imageUri);
		bboxSectionProvider.refresh();
	});

	const refreshTrees = (): void => {
		projectProvider.refresh();
		bboxSectionProvider.refresh();
	};

	const editorProvider = new BoundingBoxEditorProvider(context, {
		onBboxSaved: refreshTrees,
		onEditorOpened: (imageUri: vscode.Uri) => {
			setSelectedImageUri(imageUri);
			bboxSectionProvider.refresh();
		},
	});

	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			'boundingBoxEditor.imageEditor',
			editorProvider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);

	context.subscriptions.push(
		vscode.window.createTreeView('boundingBoxEditor.bboxSectionView', {
			treeDataProvider: bboxSectionProvider,
		}),
	);

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
			if (!folder) {
				return;
			}
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

	const disposable = vscode.commands.registerCommand('bounding-box-editor.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from bounding-box-editor!');
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
