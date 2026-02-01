import * as vscode from 'vscode';

let selectedImageUri: vscode.Uri | undefined;
let selectedBoxIndices: number[] = [];

export function getSelectedImageUri(): vscode.Uri | undefined {
	return selectedImageUri;
}

export function setSelectedImageUri(uri: vscode.Uri | undefined): void {
	selectedImageUri = uri;
}

export function getSelectedBoxIndices(): number[] {
	return [...selectedBoxIndices];
}

export function setSelectedBoxIndices(indices: number[]): void {
	selectedBoxIndices = indices.slice();
}

export function getSelectedBoxIndex(): number | undefined {
	return selectedBoxIndices.length === 1 ? selectedBoxIndices[0] : undefined;
}

export function setSelectedBoxIndex(index: number | undefined): void {
	setSelectedBoxIndices(index !== undefined ? [index] : []);
}
