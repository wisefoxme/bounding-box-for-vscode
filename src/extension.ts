import * as vscode from 'vscode';
import { registerExplorer } from './explorer';
import { BoundingBoxEditorProvider } from './editorProvider';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			'boundingBoxEditor.imageEditor',
			new BoundingBoxEditorProvider(context),
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);
	registerExplorer(context);

	const disposable = vscode.commands.registerCommand('bounding-box-editor.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from bounding-box-editor!');
	});
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
