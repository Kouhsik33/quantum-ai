import * as vscode from 'vscode';
import { AIProvider } from '../granite';

export class ExplainCommand {
    constructor(private aiProvider: AIProvider) {}

    async execute(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('Please select some code to explain');
            return;
        }

        const selectedText = editor.document.getText(selection);
        
        try {
            // Show progress indicator
            const explanation = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Quantum AI',
                cancellable: false
            }, async () => {
                return await this.aiProvider.explain(selectedText);
            });

            // Show result in modal
            vscode.window.showInformationMessage(explanation, { modal: true });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get explanation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}