import * as vscode from 'vscode';
import { AIProvider } from './granite';

export class QuantumCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    constructor(private aiProvider: AIProvider) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        // Only provide fix for non-empty selections
        if (range.isEmpty) {
            return [];
        }

        const selectedText = document.getText(range);
        if (!selectedText || selectedText.trim().length === 0) {
            return [];
        }

        const fixAction = new vscode.CodeAction('Fix with AI', vscode.CodeActionKind.QuickFix);
        fixAction.command = {
            command: 'quantum-ai.applyFix',
            title: 'Fix with AI',
            arguments: [document, range]
        };
        fixAction.isPreferred = false;

        return [fixAction];
    }
}