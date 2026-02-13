import * as vscode from 'vscode';
import { GraniteProvider } from './granite';
import { QuantumInlineCompletionProvider } from './inline';
import { QuantumCodeActionProvider } from './codeAction';
import { ExplainCommand } from './commands/explain';
import { ApplyFixCommand } from './commands/applyFix';
import { checkForUpdates } from './updateChecker';




export function activate(context: vscode.ExtensionContext) {
    checkForUpdates(context);
    console.log('Quantum AI extension activated');

    // Initialize the AI provider
    const graniteProvider = new GraniteProvider();

    // Register inline completion provider
    if (vscode.workspace.getConfiguration('quantum-ai').get('completionEnabled')) {
        const inlineProvider = new QuantumInlineCompletionProvider(graniteProvider);
        context.subscriptions.push(
            vscode.languages.registerInlineCompletionItemProvider(
                { pattern: '**' },
                inlineProvider
            )
        );
    }

    // Register code action provider for quick fixes
    const codeActionProvider = new QuantumCodeActionProvider(graniteProvider);
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { pattern: '**' },
            codeActionProvider,
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

    // Register commands
    const explainCommand = new ExplainCommand(graniteProvider);
    const applyFixCommand = new ApplyFixCommand(graniteProvider);

    context.subscriptions.push(
        vscode.commands.registerCommand('quantum-ai.explain', () => explainCommand.execute()),
        vscode.commands.registerCommand('quantum-ai.applyFix', (document: vscode.TextDocument, range: vscode.Range) => 
            applyFixCommand.execute(document, range)
        )
    );
}

export function deactivate() {}