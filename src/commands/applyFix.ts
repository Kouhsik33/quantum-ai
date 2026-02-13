import * as vscode from 'vscode';
import { AIProvider } from '../granite';

export class ApplyFixCommand {
    constructor(private aiProvider: AIProvider) {}

    async execute(document: vscode.TextDocument, range: vscode.Range): Promise<void> {
        const selectedText = document.getText(range);
        
        try {
            // Get fix from AI
            const fixedCode = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Quantum AI fixing code...',
                cancellable: false
            }, async () => {
                return await this.aiProvider.fix(selectedText);
            });

            if (!fixedCode || fixedCode.trim().length === 0) {
                vscode.window.showErrorMessage('AI returned empty fix');
                return;
            }

            // Apply the fix using workspace edit
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, range, fixedCode);
            
            const success = await vscode.workspace.applyEdit(edit);
            
            if (success) {
                vscode.window.setStatusBarMessage('AI fix applied', 3000);
            } else {
                vscode.window.showErrorMessage('Failed to apply AI fix');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to apply fix: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}