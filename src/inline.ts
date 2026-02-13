import * as vscode from 'vscode';
import { AIProvider } from './granite';

export class QuantumInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(private aiProvider: AIProvider) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        const line = document.lineAt(position.line);
        
        // Trigger only when line length > 3
        if (line.text.trim().length <= 3) {
            return null;
        }

        // Build context from last 20 lines
        const maxLines = vscode.workspace.getConfiguration('quantum-ai').get('maxLinesForContext', 20);
        const startLine = Math.max(0, position.line - maxLines);
        const contextRange = new vscode.Range(startLine, 0, position.line, line.text.length);
        const context = document.getText(contextRange);

        try {
            const completion = await this.aiProvider.complete(context);
            
            if (!completion || completion.trim().length === 0) {
                return null;
            }

            // Create inline completion item
            const item = new vscode.InlineCompletionItem(
                completion,
                new vscode.Range(position, position),
                {
                    title: "Accept AI Completion",
                    command: "quantum-ai.applyFix",
                    arguments: [document, new vscode.Range(position, position)]
                }
            );

            return [item];
        } catch (error) {
            console.error('Inline completion error:', error);
            return null;
        }
    }
}