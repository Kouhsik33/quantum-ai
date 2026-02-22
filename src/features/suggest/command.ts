// src/features/suggest/command.ts
import * as vscode from 'vscode';
import { AIProvider } from '../../providers/aiProvider';  // Fixed import path

export class SuggestCommand {
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
        const selectedText = selection.isEmpty 
            ? editor.document.getText()
            : editor.document.getText(selection);
        
        const languageId = editor.document.languageId;
        
        try {
            const suggestions = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Generating suggestions...',
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    throw new Error('Cancelled');
                });

                return await this.aiProvider.suggest(selectedText, languageId);
            });

            if (!suggestions) {
                return;
            }

            await this.showSuggestionsInWebview(suggestions, selectedText, languageId);

        } catch (error) {
            if (error instanceof Error && error.message === 'Cancelled') {
                vscode.window.showInformationMessage('Suggestions cancelled');
            } else {
                vscode.window.showErrorMessage(`Failed to get suggestions: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    private async showSuggestionsInWebview(suggestions: string, originalCode: string, language: string): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'quantumAISuggestions',
            'AI Improvement Suggestions',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getWebviewContent(suggestions, originalCode, language);

        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'applySuggestion':
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        await this.applySuggestion(editor, message.code);
                    }
                    break;
                case 'copySuggestion':
                    vscode.env.clipboard.writeText(message.code);
                    vscode.window.showInformationMessage('Suggestion copied to clipboard');
                    break;
            }
        });
    }

    private getWebviewContent(suggestions: string, originalCode: string, language: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                        padding: 20px;
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .header {
                        margin-bottom: 20px;
                        padding-bottom: 10px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .content {
                        display: flex;
                        gap: 20px;
                    }
                    .original-code, .suggestions {
                        flex: 1;
                    }
                    .code-block {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 12px;
                        border-radius: 4px;
                        overflow-x: auto;
                        white-space: pre-wrap;
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                    }
                    .button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 4px 12px;
                        border-radius: 2px;
                        cursor: pointer;
                        font-size: 12px;
                        margin-right: 8px;
                        margin-bottom: 10px;
                    }
                    .button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>✨ AI Improvement Suggestions</h2>
                </div>
                <div class="content">
                    <div class="original-code">
                        <h3>Original Code</h3>
                        <pre class="code-block">${this.escapeHtml(originalCode)}</pre>
                    </div>
                    <div class="suggestions">
                        <h3>Suggestions</h3>
                        <pre class="code-block">${this.escapeHtml(suggestions)}</pre>
                        <button class="button" onclick="copySuggestions()">Copy Suggestions</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function copySuggestions() {
                        const suggestions = ${JSON.stringify(suggestions)};
                        vscode.postMessage({ command: 'copySuggestion', code: suggestions });
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

    private async applySuggestion(editor: vscode.TextEditor, code: string): Promise<void> {
        const apply = await vscode.window.showWarningMessage(
            'Apply this suggestion? This will replace the current selection.',
            { modal: false },
            'Apply',
            'Cancel'
        );

        if (apply !== 'Apply') {
            return;
        }

        const selection = editor.selection;
        const range = selection.isEmpty 
            ? new vscode.Range(0, 0, editor.document.lineCount - 1, editor.document.lineAt(editor.document.lineCount - 1).text.length)
            : selection;
        
        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, range, code);
        
        const success = await vscode.workspace.applyEdit(edit);
        
        if (success) {
            vscode.window.setStatusBarMessage('$(check) Suggestion applied', 3000);
        } else {
            vscode.window.showErrorMessage('Failed to apply suggestion');
        }
    }
}





// import * as vscode from 'vscode';
// import { AIProvider } from '../granite';

// export class SuggestCommand {
//     constructor(private aiProvider: AIProvider) {}

//     async execute(): Promise<void> {
//         const editor = vscode.window.activeTextEditor;
//         if (!editor) {
//             vscode.window.showErrorMessage('No active editor');
//             return;
//         }

//         const selection = editor.selection;
//         const selectedText = selection.isEmpty 
//             ? editor.document.getText()
//             : editor.document.getText(selection);
        
//         const languageId = editor.document.languageId;
        
//         try {
//             const suggestions = await vscode.window.withProgress({
//                 location: vscode.ProgressLocation.Notification,
//                 title: 'Generating suggestions...',
//                 cancellable: true
//             }, async (progress, token) => {
//                 token.onCancellationRequested(() => {
//                     throw new Error('Cancelled');
//                 });

//                 return await this.aiProvider.suggest(selectedText, languageId);
//             });

//             if (!suggestions) {
//                 return;
//             }

//             // SHOW suggestions in a webview, NOT replace code
//             await this.showSuggestionsInWebview(suggestions, selectedText, languageId);

//         } catch (error) {
//             if (error instanceof Error && error.message === 'Cancelled') {
//                 vscode.window.showInformationMessage('Suggestions cancelled');
//             } else {
//                 vscode.window.showErrorMessage(`Failed to get suggestions: ${error instanceof Error ? error.message : String(error)}`);
//             }
//         }
//     }

//     private async showSuggestionsInWebview(suggestions: string, originalCode: string, language: string): Promise<void> {
//         const panel = vscode.window.createWebviewPanel(
//             'quantumAISuggestions',
//             'AI Improvement Suggestions',
//             vscode.ViewColumn.Beside,
//             {
//                 enableScripts: true,
//                 retainContextWhenHidden: true,
//                 localResourceRoots: []
//             }
//         );

//         panel.webview.html = this.getWebviewContent(suggestions, originalCode, language);

//         // Handle messages from webview
//         panel.webview.onDidReceiveMessage(async message => {
//             switch (message.command) {
//                 case 'applySuggestion':
//                     // Only apply if user explicitly clicks apply
//                     const editor = vscode.window.activeTextEditor;
//                     if (editor) {
//                         await this.applySuggestion(editor, message.code);
//                     }
//                     break;
//                 case 'copySuggestion':
//                     vscode.env.clipboard.writeText(message.code);
//                     vscode.window.showInformationMessage('Suggestion copied to clipboard');
//                     break;
//             }
//         });
//     }

//     private getWebviewContent(suggestions: string, originalCode: string, language: string): string {
//         return `
//             <!DOCTYPE html>
//             <html>
//             <head>
//                 <meta charset="UTF-8">
//                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
//                 <style>
//                     :root {
//                         --container-padding: 20px;
//                         --editor-font-family: ${this.getFontFamily()};
//                         --editor-font-size: ${this.getFontSize()};
//                     }
                    
//                     body {
//                         font-family: var(--editor-font-family);
//                         font-size: var(--editor-font-size);
//                         padding: 0;
//                         margin: 0;
//                         color: var(--vscode-editor-foreground);
//                         background-color: var(--vscode-editor-background);
//                     }
                    
//                     .container {
//                         display: flex;
//                         flex-direction: column;
//                         height: 100vh;
//                     }
                    
//                     .header {
//                         padding: 10px var(--container-padding);
//                         background-color: var(--vscode-sideBar-background);
//                         border-bottom: 1px solid var(--vscode-panel-border);
//                         display: flex;
//                         justify-content: space-between;
//                         align-items: center;
//                     }
                    
//                     .header h2 {
//                         margin: 0;
//                         font-size: 14px;
//                         font-weight: 600;
//                         text-transform: uppercase;
//                         color: var(--vscode-foreground);
//                     }
                    
//                     .actions {
//                         display: flex;
//                         gap: 8px;
//                     }
                    
//                     .button {
//                         background-color: var(--vscode-button-background);
//                         color: var(--vscode-button-foreground);
//                         border: none;
//                         padding: 4px 12px;
//                         border-radius: 2px;
//                         cursor: pointer;
//                         font-size: 12px;
//                         font-family: inherit;
//                     }
                    
//                     .button:hover {
//                         background-color: var(--vscode-button-hoverBackground);
//                     }
                    
//                     .button.secondary {
//                         background-color: var(--vscode-button-secondaryBackground);
//                         color: var(--vscode-button-secondaryForeground);
//                     }
                    
//                     .button.secondary:hover {
//                         background-color: var(--vscode-button-secondaryHoverBackground);
//                     }
                    
//                     .content {
//                         display: flex;
//                         flex: 1;
//                         overflow: hidden;
//                     }
                    
//                     .original-code, .suggestions {
//                         flex: 1;
//                         display: flex;
//                         flex-direction: column;
//                         overflow: hidden;
//                     }
                    
//                     .original-code {
//                         border-right: 1px solid var(--vscode-panel-border);
//                     }
                    
//                     .section-header {
//                         padding: 8px var(--container-padding);
//                         background-color: var(--vscode-sideBar-background);
//                         border-bottom: 1px solid var(--vscode-panel-border);
//                         font-size: 12px;
//                         font-weight: 600;
//                         color: var(--vscode-descriptionForeground);
//                     }
                    
//                     .code-container {
//                         flex: 1;
//                         overflow: auto;
//                         padding: var(--container-padding);
//                     }
                    
//                     pre {
//                         margin: 0;
//                         font-family: var(--editor-font-family);
//                         font-size: var(--editor-font-size);
//                         white-space: pre-wrap;
//                         word-wrap: break-word;
//                     }
                    
//                     code {
//                         font-family: var(--editor-font-family);
//                         font-size: var(--editor-font-size);
//                     }
                    
//                     .suggestion-item {
//                         background-color: var(--vscode-editor-inactiveSelectionBackground);
//                         border-radius: 4px;
//                         padding: 12px;
//                         margin-bottom: 16px;
//                         border: 1px solid var(--vscode-panel-border);
//                     }
                    
//                     .suggestion-item:last-child {
//                         margin-bottom: 0;
//                     }
                    
//                     .suggestion-header {
//                         display: flex;
//                         justify-content: space-between;
//                         align-items: center;
//                         margin-bottom: 8px;
//                         font-size: 12px;
//                         color: var(--vscode-descriptionForeground);
//                     }
                    
//                     .suggestion-actions {
//                         display: flex;
//                         gap: 8px;
//                     }
                    
//                     .suggestion-content {
//                         margin: 0;
//                         padding: 12px;
//                         background-color: var(--vscode-textCodeBlock-background);
//                         border-radius: 4px;
//                         overflow-x: auto;
//                         font-family: var(--editor-font-family);
//                         font-size: var(--editor-font-size);
//                         line-height: 1.5;
//                     }
                    
//                     .explanation-text {
//                         line-height: 1.6;
//                         color: var(--vscode-editor-foreground);
//                     }
                    
//                     .explanation-text p {
//                         margin: 0 0 12px 0;
//                     }
                    
//                     .explanation-text code {
//                         background-color: var(--vscode-textCodeBlock-background);
//                         padding: 2px 4px;
//                         border-radius: 3px;
//                         font-family: var(--editor-font-family);
//                         font-size: 0.9em;
//                     }
                    
//                     .explanation-text pre {
//                         background-color: var(--vscode-textCodeBlock-background);
//                         padding: 12px;
//                         border-radius: 4px;
//                         overflow-x: auto;
//                         margin: 12px 0;
//                     }
                    
//                     .badge {
//                         background-color: var(--vscode-badge-background);
//                         color: var(--vscode-badge-foreground);
//                         padding: 2px 8px;
//                         border-radius: 10px;
//                         font-size: 11px;
//                         font-weight: 500;
//                     }
//                 </style>
//             </head>
//             <body>
//                 <div class="container">
//                     <div class="header">
//                         <h2>✨ AI Improvement Suggestions</h2>
//                         <div class="actions">
//                             <button class="button secondary" onclick="copyAll()">Copy All</button>
//                             <button class="button" onclick="closePanel()">Close</button>
//                         </div>
//                     </div>
                    
//                     <div class="content">
//                         <div class="original-code">
//                             <div class="section-header">
//                                 Original Code
//                                 <span class="badge" style="margin-left: 8px;">${language}</span>
//                             </div>
//                             <div class="code-container">
//                                 <pre><code>${this.escapeHtml(originalCode)}</code></pre>
//                             </div>
//                         </div>
                        
//                         <div class="suggestions">
//                             <div class="section-header">Suggestions & Improvements</div>
//                             <div class="code-container">
//                                 ${this.formatSuggestions(suggestions)}
//                             </div>
//                         </div>
//                     </div>
//                 </div>

//                 <script>
//                     const vscode = acquireVsCodeApi();
                    
//                     function applySuggestion(code) {
//                         vscode.postMessage({
//                             command: 'applySuggestion',
//                             code: code
//                         });
//                     }
                    
//                     function copySuggestion(code) {
//                         vscode.postMessage({
//                             command: 'copySuggestion',
//                             code: code
//                         });
//                     }
                    
//                     function copyAll() {
//                         const suggestions = document.querySelectorAll('.suggestion-content');
//                         let allText = '';
//                         suggestions.forEach((s, i) => {
//                             allText += 'Suggestion ' + (i + 1) + ':\\n' + s.textContent + '\\n\\n';
//                         });
//                         navigator.clipboard.writeText(allText);
//                         vscode.postMessage({ command: 'copySuggestion', code: allText });
//                     }
                    
//                     function closePanel() {
//                         vscode.postMessage({ command: 'close' });
//                     }
//                 </script>
//             </body>
//             </html>
//         `;
//     }

//     private getFontFamily(): string {
//         const config = vscode.workspace.getConfiguration('editor');
//         return config.get('fontFamily') || 'Consolas, "Courier New", monospace';
//     }

//     private getFontSize(): string {
//         const config = vscode.workspace.getConfiguration('editor');
//         return config.get('fontSize') + 'px' || '14px';
//     }

//     private escapeHtml(text: string): string {
//         return text
//             .replace(/&/g, '&amp;')
//             .replace(/</g, '&lt;')
//             .replace(/>/g, '&gt;')
//             .replace(/"/g, '&quot;')
//             .replace(/'/g, '&#039;');
//     }

//     private formatSuggestions(suggestions: string): string {
//         // Split suggestions into sections
//         const sections = suggestions.split(/\n(?=\d+\.|\*|\#)/g);
        
//         if (sections.length <= 1) {
//             // If no clear sections, show as one suggestion
//             return `
//                 <div class="suggestion-item">
//                     <div class="suggestion-header">
//                         <span>💡 Suggestion</span>
//                         <div class="suggestion-actions">
//                             <button class="button secondary" onclick="copySuggestion(${JSON.stringify(suggestions)})">Copy</button>
//                         </div>
//                     </div>
//                     <pre class="suggestion-content explanation-text">${this.formatExplanation(suggestions)}</pre>
//                 </div>
//             `;
//         }

//         return sections.map((section, index) => {
//             if (!section.trim()) return '';
            
//             // Try to extract code blocks
//             const codeBlockMatch = section.match(/```(?:\w*)\n([\s\S]*?)```/);
//             const hasCode = codeBlockMatch !== null;
            
//             return `
//                 <div class="suggestion-item">
//                     <div class="suggestion-header">
//                         <span>💡 Suggestion ${index + 1}</span>
//                         <div class="suggestion-actions">
//                             ${hasCode ? `<button class="button secondary" onclick="copySuggestion(${JSON.stringify(codeBlockMatch![1])})">Copy Code</button>` : ''}
//                             <button class="button secondary" onclick="copySuggestion(${JSON.stringify(section)})">Copy All</button>
//                         </div>
//                     </div>
//                     <div class="suggestion-content explanation-text">${this.formatExplanation(section)}</div>
//                 </div>
//             `;
//         }).join('');
//     }

//     private formatExplanation(text: string): string {
//         // Convert markdown-like syntax to HTML with proper styling
//         return text
//             .replace(/&/g, '&amp;')
//             .replace(/</g, '&lt;')
//             .replace(/>/g, '&gt;')
//             .replace(/\n\n/g, '</p><p>')
//             .replace(/\n/g, '<br>')
//             .replace(/`([^`]+)`/g, '<code>$1</code>')
//             .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
//             .replace(/\*([^*]+)\*/g, '<em>$1</em>')
//             .replace(/^### (.*$)/gm, '<h3>$1</h3>')
//             .replace(/^## (.*$)/gm, '<h2>$1</h2>')
//             .replace(/^# (.*$)/gm, '<h1>$1</h1>')
//             .replace(/```(?:\w*)\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
//     }

//     private async applySuggestion(editor: vscode.TextEditor, code: string): Promise<void> {
//         // Show confirmation before applying
//         const apply = await vscode.window.showWarningMessage(
//             'Apply this suggestion? This will replace the current selection.',
//             { modal: false },
//             'Apply',
//             'Cancel'
//         );

//         if (apply !== 'Apply') {
//             return;
//         }

//         const selection = editor.selection;
//         const range = selection.isEmpty 
//             ? new vscode.Range(0, 0, editor.document.lineCount - 1, editor.document.lineAt(editor.document.lineCount - 1).text.length)
//             : selection;
        
//         const edit = new vscode.WorkspaceEdit();
//         edit.replace(editor.document.uri, range, code);
        
//         const success = await vscode.workspace.applyEdit(edit);
        
//         if (success) {
//             vscode.window.setStatusBarMessage('$(check) Suggestion applied', 3000);
//         } else {
//             vscode.window.showErrorMessage('Failed to apply suggestion');
//         }
//     }
// }