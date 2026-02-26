// src/extension.ts (No Auth Required - Backend Available)
import * as vscode from 'vscode';
import { QuantumHubProvider } from './providers/quantumHubProvider';
import { AIProvider } from './providers/aiProvider';
import { QuantumInlineCompletionProvider } from './features/inlineCompletion/provider';
import { QuantumCodeActionProvider } from './features/codeActions/provider';
import { ExplainCommand } from './features/explain/command';
import { ApplyFixCommand } from './features/fix/command';
import { SuggestCommand } from './features/suggest/command';
import { ConfigService } from './services/configService';
import { ErrorHandler, ErrorSeverity } from './services/errorHandler';
import { CacheService } from './services/cacheService';
import { TranspileCommand } from './features/transpile/command';
import { ChatViewProvider } from './chatbot/chatView';  // NEW: Import chat view

let aiProvider: AIProvider;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let configService: ConfigService;
let errorHandler: ErrorHandler;


export async function activate(context: vscode.ExtensionContext) {
    // Initialize services
    outputChannel = vscode.window.createOutputChannel('Quantum AI');
    outputChannel.appendLine('Quantum AI extension is now active');
    
    configService = ConfigService.getInstance();
    errorHandler = ErrorHandler.getInstance(context);
    
    // Initialize cache service
    CacheService.getInstance(context);

    // Initialize Quantum Hub provider
    aiProvider = new QuantumHubProvider(context, outputChannel);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(sparkle) Quantum AI";
    statusBarItem.tooltip = "Quantum AI Assistant";
    statusBarItem.command = "quantum-ai.configure";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register providers with supported languages
    const supportedLanguages = [
        'python', 'javascript', 'typescript', 'c', 'cpp', 'rust'
    ];

    const languageSelector = supportedLanguages.map(lang => ({ 
        language: lang, 
        scheme: 'file' 
    }));

    // Register inline completion provider
    if (configService.get('completionEnabled', true)) {
        try {
            const inlineProvider = new QuantumInlineCompletionProvider(aiProvider);
            context.subscriptions.push(
                vscode.languages.registerInlineCompletionItemProvider(
                    languageSelector,
                    inlineProvider
                )
            );
            outputChannel.appendLine('Inline completion provider registered');
        } catch (error) {
            errorHandler.handleError(error, {
                operation: 'registerInlineCompletion',
                severity: ErrorSeverity.ERROR,
                userMessage: 'Failed to register inline completion provider'
            });
        }
    }

    // Register code action provider
    try {
        const codeActionProvider = new QuantumCodeActionProvider(aiProvider);
        context.subscriptions.push(
            vscode.languages.registerCodeActionsProvider(
                languageSelector,
                codeActionProvider,
                { providedCodeActionKinds: QuantumCodeActionProvider.providedCodeActionKinds }
            )
        );
        outputChannel.appendLine('Code action provider registered');
    } catch (error) {
        errorHandler.handleError(error, {
            operation: 'registerCodeActions',
            severity: ErrorSeverity.ERROR,
            userMessage: 'Failed to register code actions'
        });
    }

    // Initialize commands
    const explainCommand = new ExplainCommand(aiProvider, outputChannel);
    const applyFixCommand = new ApplyFixCommand(aiProvider, outputChannel);
    const suggestCommand = new SuggestCommand(aiProvider, outputChannel);
    const transpileCommand = new TranspileCommand(aiProvider, outputChannel, context);

    // NEW: Register Chat View Provider
    const chatProvider = new ChatViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('quantumAI.chatView', chatProvider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('quantum-ai.explain', () => 
            executeCommandSafely(() => explainCommand.execute(), 'explain')
        ),
        vscode.commands.registerCommand('quantum-ai.fix', (document, range) => 
            executeCommandSafely(() => applyFixCommand.execute(document, range), 'fix')
        ),
        vscode.commands.registerCommand('quantum-ai.applyFix', (document, range) => 
            executeCommandSafely(() => applyFixCommand.execute(document, range), 'applyFix')
        ),
        vscode.commands.registerCommand('quantum-ai.suggest', () => 
            executeCommandSafely(() => suggestCommand.execute(), 'suggest')
        ),
        vscode.commands.registerCommand('quantum-ai.transpile', () => 
            executeCommandSafely(() => transpileCommand.execute(), 'transpile')
        ),
        vscode.commands.registerCommand('quantum-ai.configure', () => configure()),
        vscode.commands.registerCommand('quantum-ai.clearCache', () => clearCache()),
        vscode.commands.registerCommand('quantum-ai.toggleCompletion', () => toggleCompletion()),
        vscode.commands.registerCommand('quantum-ai.showOutput', () => outputChannel.show()),
        vscode.commands.registerCommand('quantum-ai.checkBackend', () => checkBackendStatus()),
        // NEW: Add chat open command
        vscode.commands.registerCommand('quantum-ai.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.quantum-ai');
        })
    );

    // Register configuration change listener
    context.subscriptions.push(
        configService.onDidChange(updateStatusBar)
    );

    // Initial status bar update
    updateStatusBar();

    // Check backend connection
    setTimeout(() => checkBackendStatus(), 1000);

    outputChannel.appendLine('Quantum AI extension activated successfully');
}

function executeCommandSafely(command: () => Promise<void>, commandName: string): void {
    command().catch(error => {
        errorHandler.handleError(error, {
            operation: `command:${commandName}`,
            severity: ErrorSeverity.ERROR,
            userMessage: `Failed to execute ${commandName} command`
        });
    });
}

async function checkBackendStatus() {
    try {
        outputChannel.appendLine('Checking backend connection...');
        const provider = aiProvider as QuantumHubProvider;
        const status = await provider.checkHealth();
        
        if (status.healthy) {
            outputChannel.appendLine(`✅ Backend connected: ${status.message}`);
            statusBarItem.tooltip = `Quantum AI - Connected to ${status.version || 'backend'}`;
            
            // Show success notification once
            vscode.window.setStatusBarMessage('$(check) Connected to Quantum AI backend', 3000);
        } else {
            outputChannel.appendLine(`⚠️ Backend connection issue: ${status.message}`);
            statusBarItem.tooltip = 'Quantum AI - Backend connection issue';
            vscode.window.showWarningMessage(`⚠️ Cannot connect to backend: ${status.message}`);
        }
    } catch (error) {
        outputChannel.appendLine(`❌ Backend connection failed: ${error}`);
        statusBarItem.tooltip = 'Quantum AI - Backend unavailable';
        vscode.window.showErrorMessage('Failed to connect to Quantum AI backend. Check if server is running.');
    }
}

function updateStatusBar() {
    const enabled = configService.get('completionEnabled', true);
    
    statusBarItem.text = enabled 
        ? "$(sparkle) Quantum AI"
        : "$(circle-slash) Quantum AI";
    
    statusBarItem.tooltip = enabled
        ? "Quantum AI Assistant - Click to configure"
        : "Quantum AI is disabled - Click to configure";
}

async function configure() {
    const config = configService.getAll();
    
    // Create QuickPickItem array
    const options: vscode.QuickPickItem[] = [
        {
            label: "$(check) Enable/Disable Completions",
            description: `Currently: ${config.completionEnabled ? 'Enabled' : 'Disabled'}`,
            detail: "Toggle inline code completions"
        },
        {
            label: "$(symbol-numeric) Set Max Context Lines",
            description: `Current: ${config.maxLinesForContext} lines`,
            detail: "Number of lines to include as context for completions"
        },
        {
            label: "$(gear) Temperature",
            description: `Current: ${config.temperature}`,
            detail: "Set temperature (0=precise, 1=creative)"
        },
        {
            label: "$(gear) Explanation Detail Level",
            description: `Current: ${config.explanationDetailLevel}`,
            detail: "Set detail level for code explanations"
        },
        {
            label: "$(database) Clear Cache",
            description: "Clear cached AI responses",
            detail: "Free up memory by clearing the cache"
        },
        {
            label: "$(plug) Check Backend Connection",
            description: "Test connection to backend",
            detail: "Verify the backend API is reachable"
        },
        {
            label: "$(output) Show Output Channel",
            description: "View extension logs",
            detail: "Open the output channel for debugging"
        },
        {
            label: "$(question) About",
            description: "Learn more about Quantum AI",
            detail: `Version: ${vscode.extensions.getExtension('quantumHub.quantum-ai')?.packageJSON.version || 'unknown'}`
        }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: "Configure Quantum AI",
        title: "Quantum AI Settings"
    });

    if (!selected) return;

    // Handle selection based on label
    if (selected.label.includes("Enable/Disable")) {
        const current = config.completionEnabled;
        await configService.update('completionEnabled', !current);
        vscode.window.showInformationMessage(`Completions ${!current ? 'enabled' : 'disabled'}`);
    }
    else if (selected.label.includes("Max Context")) {
        const value = await vscode.window.showInputBox({
            prompt: "Enter max lines of context (5-100)",
            value: config.maxLinesForContext.toString(),
            validateInput: (input) => {
                const num = parseInt(input);
                if (isNaN(num) || num < 5 || num > 100) {
                    return "Please enter a number between 5 and 100";
                }
                return null;
            }
        });
        if (value) {
            await configService.update('maxLinesForContext', parseInt(value));
        }
    }
    else if (selected.label.includes("Temperature")) {
        const value = await vscode.window.showInputBox({
            prompt: "Enter temperature (0.0 - 1.0)",
            value: config.temperature.toString(),
            validateInput: (input) => {
                const num = parseFloat(input);
                if (isNaN(num) || num < 0 || num > 1) {
                    return "Please enter a number between 0 and 1";
                }
                return null;
            }
        });
        if (value) {
            await configService.update('temperature', parseFloat(value));
        }
    }
    else if (selected.label.includes("Explanation Detail")) {
        const detailOptions: vscode.QuickPickItem[] = [
            { label: "beginner", description: "Simple explanations for beginners" },
            { label: "intermediate", description: "Detailed with quantum concepts" },
            { label: "advanced", description: "Includes mathematical formulations" }
        ];
        
        const value = await vscode.window.showQuickPick(detailOptions, {
            placeHolder: 'Select detail level',
        });
        
        if (value) {
            await configService.update('explanationDetailLevel', value.label as 'beginner' | 'intermediate' | 'advanced');
        }
    }
    else if (selected.label.includes("Clear Cache")) {
        await clearCache();
    }
    else if (selected.label.includes("Check Backend")) {
        await checkBackendStatus();
    }
    else if (selected.label.includes("Show Output")) {
        outputChannel.show();
    }
    else if (selected.label.includes("About")) {
        const version = vscode.extensions.getExtension('quantumHub.quantum-ai')?.packageJSON.version || 'unknown';
        vscode.window.showInformationMessage(
            `Quantum AI Assistant v${version}\n\n` +
            'AI-powered quantum code assistant\n\n' +
            'Features:\n' +
            '• Inline code completions\n' +
            '• Code explanations\n' +
            '• Bug fixes\n' +
            '• Code improvements\n\n' +
            'Backend: No authentication required\n' +
            'Status: Connected to backend API',
            { modal: true }
        );
    }
}

async function clearCache() {
    try {
        aiProvider.clearCache?.();
        await CacheService.getInstance(undefined as any).clear();
        vscode.window.showInformationMessage('✅ Cache cleared successfully');
        outputChannel.appendLine('Cache cleared');
    } catch (error) {
        errorHandler.handleError(error, {
            operation: 'clearCache',
            severity: ErrorSeverity.ERROR,
            userMessage: 'Failed to clear cache'
        });
    }
}

async function toggleCompletion() {
    const current = configService.get('completionEnabled', true);
    await configService.update('completionEnabled', !current);
    updateStatusBar();
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    if (aiProvider) {
        aiProvider.clearCache?.();
    }
    if (outputChannel) {
        outputChannel.appendLine('Quantum AI extension deactivated');
        outputChannel.dispose();                                                                   
    }
}