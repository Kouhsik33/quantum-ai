// src/features/inlineCompletion/provider.ts
import * as vscode from 'vscode';
import { AIProvider } from '../../providers/aiProvider';  // Fixed import path

export class QuantumInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | undefined;
    private abortController: AbortController | undefined;

    constructor(private aiProvider: AIProvider) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        const config = vscode.workspace.getConfiguration('quantum-ai');
        const enabled = config.get<boolean>('completionEnabled', true);
        
        if (!enabled) {
            return null;
        }

        // Cancel previous request
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();

        // Get the current line up to cursor position
        const line = document.lineAt(position.line);
        const textBeforeCursor = line.text.substring(0, position.character);
        const trimmedTextBeforeCursor = textBeforeCursor.trim();
        
        // Don't trigger on empty lines or very short lines
        if (trimmedTextBeforeCursor.length < 3) {
            return null;
        }

        // Don't trigger if we're in the middle of a word
        const charBeforeCursor = position.character > 0 ? line.text.charAt(position.character - 1) : '';
        if (/[a-zA-Z0-9_]/.test(charBeforeCursor) && trimmedTextBeforeCursor.length < 10) {
            return null;
        }

        // Debounce to avoid too many requests
        const debounceDelay = config.get<number>('debounceDelay', 300);
        
        return new Promise((resolve) => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(async () => {
                try {
                    // Build context (only code BEFORE the cursor)
                    const contextText = this.buildCompletionContext(document, position);
                    
                    if (!contextText || contextText.length < 10) {
                        resolve(null);
                        return;
                    }

                    // Get completion from AI
                    const completion = await this.aiProvider.complete(contextText, document.languageId);

                    if (!completion || completion.length === 0 || token.isCancellationRequested) {
                        resolve(null);
                        return;
                    }

                    // Clean the completion
                    let cleanCompletion = this.cleanCompletion(completion, textBeforeCursor);
                    
                    if (!cleanCompletion) {
                        resolve(null);
                        return;
                    }

                    // Create the completion item
                    const item = new vscode.InlineCompletionItem(
                        cleanCompletion,
                        new vscode.Range(position, position)
                    );

                    resolve([item]);

                } catch (error) {
                    console.error('Inline completion error:', error);
                    resolve(null);
                }
            }, debounceDelay);
        });
    }

    private buildCompletionContext(document: vscode.TextDocument, position: vscode.Position): string {
        const config = vscode.workspace.getConfiguration('quantum-ai');
        const maxLines = config.get<number>('maxLinesForContext', 20);
        
        // Only get text BEFORE the cursor position
        const startLine = Math.max(0, position.line - maxLines);
        const contextLines: string[] = [];
        
        // Add lines before current line
        for (let i = startLine; i < position.line; i++) {
            contextLines.push(document.lineAt(i).text);
        }
        
        // Add current line up to cursor
        const currentLine = document.lineAt(position.line);
        contextLines.push(currentLine.text.substring(0, position.character));
        
        return contextLines.join('\n');
    }

    private cleanCompletion(completion: string, textBeforeCursor: string): string | null {
        // Remove markdown code blocks
        completion = completion.replace(/```[\s\S]*?```/g, '').trim();
        
        // Check if completion starts with the text before cursor
        if (completion.startsWith(textBeforeCursor) && textBeforeCursor.length > 0) {
            completion = completion.substring(textBeforeCursor.length);
        }
        
        // Remove any lines that are just cursor position markers
        completion = completion.split('\n')
            .filter(line => !line.includes('█') && !line.includes('|') && !line.includes('•'))
            .join('\n');
        
        return completion.trim() || null;
    }
}