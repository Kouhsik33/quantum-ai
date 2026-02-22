// src/features/explain/command.ts
import * as vscode from 'vscode';
import { AIProvider } from '../../providers/aiProvider';  // Fixed import path

export class ExplainCommand {
    constructor(
        private aiProvider: AIProvider,
        private outputChannel: vscode.OutputChannel
    ) {}

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
        const languageId = editor.document.languageId;
        
        try {
            // Show progress
            const explanation = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Quantum AI is analyzing your code...',
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    throw new Error('Cancelled');
                });

                return await this.aiProvider.explain(selectedText, languageId);
            });

            if (!explanation) {
                vscode.window.showErrorMessage('Failed to generate explanation');
                return;
            }

            // Create and show a webview panel
            const panel = vscode.window.createWebviewPanel(
                'quantumAIExplanation',
                'AI Code Explanation',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            panel.webview.html = this.getWebviewContent(selectedText, explanation, languageId);

        } catch (error) {
            if (error instanceof Error && error.message === 'Cancelled') {
                vscode.window.showInformationMessage('Explanation cancelled');
            } else {
                vscode.window.showErrorMessage(`Failed to get explanation: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    private getWebviewContent(code: string, explanation: string, language: string): string {
        const editorConfig = vscode.workspace.getConfiguration('editor');
        const fontFamily = editorConfig.get('fontFamily') || 'Consolas, "Courier New", monospace';
        const fontSize = editorConfig.get('fontSize') + 'px' || '14px';
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { 
                        font-family: ${fontFamily};
                        font-size: ${fontSize};
                        padding: 20px;
                        color: var(--vscode-editor-foreground);
                        background: var(--vscode-editor-background);
                        line-height: 1.6;
                    }
                    .code-block {
                        background: var(--vscode-textCodeBlock-background);
                        padding: 16px;
                        border-radius: 6px;
                        overflow-x: auto;
                        border: 1px solid var(--vscode-panel-border);
                        margin-bottom: 24px;
                        font-family: ${fontFamily};
                        font-size: ${fontSize};
                    }
                    .explanation {
                        font-family: ${fontFamily};
                        font-size: ${fontSize};
                    }
                    .explanation h3 {
                        margin-top: 0;
                        color: var(--vscode-editor-foreground);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 10px;
                        font-weight: 600;
                    }
                    .explanation-content {
                        white-space: pre-wrap;
                        line-height: 1.6;
                    }
                    .explanation-content code {
                        background: var(--vscode-textCodeBlock-background);
                        padding: 2px 4px;
                        border-radius: 3px;
                        font-family: ${fontFamily};
                        font-size: 0.9em;
                    }
                    .button {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 6px 14px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        font-family: ${fontFamily};
                        margin-right: 8px;
                        margin-bottom: 16px;
                    }
                    .button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <button class="button" onclick="copyExplanation()">Copy Explanation</button>
                <button class="button" onclick="copyCode()">Copy Code</button>
                
                <div class="code-block">
                    <pre><code>${this.escapeHtml(code)}</code></pre>
                </div>
                
                <div class="explanation">
                    <h3>📝 Explanation</h3>
                    <div class="explanation-content">${this.formatExplanation(explanation)}</div>
                </div>

                <script>
                    function copyExplanation() {
                        const explanation = document.querySelector('.explanation-content').innerText;
                        navigator.clipboard.writeText(explanation);
                    }
                    
                    function copyCode() {
                        const code = ${JSON.stringify(code)};
                        navigator.clipboard.writeText(code);
                    }
                </script>
            </body>
            </html>
        `;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private formatExplanation(text: string): string {
        return text
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    }
}