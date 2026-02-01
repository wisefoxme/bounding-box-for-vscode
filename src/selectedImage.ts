import * as vscode from 'vscode';

let selectedImageUri: vscode.Uri | undefined;

export function getSelectedImageUri(): vscode.Uri | undefined {
	return selectedImageUri;
}

export function setSelectedImageUri(uri: vscode.Uri | undefined): void {
	selectedImageUri = uri;
}
