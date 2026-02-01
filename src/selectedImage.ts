import * as vscode from 'vscode';

let selectedImageUri: vscode.Uri | undefined;
let selectedBoxIndex: number | undefined;

export function getSelectedImageUri(): vscode.Uri | undefined {
	return selectedImageUri;
}

export function setSelectedImageUri(uri: vscode.Uri | undefined): void {
	selectedImageUri = uri;
}

export function getSelectedBoxIndex(): number | undefined {
	return selectedBoxIndex;
}

export function setSelectedBoxIndex(index: number | undefined): void {
	selectedBoxIndex = index;
}
