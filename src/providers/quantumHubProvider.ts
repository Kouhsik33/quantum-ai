import * as vscode from 'vscode';
import { AIProvider } from './aiProvider';
import { QuantumHubApiService } from '../services/apiService';
import { TelemetryService } from '../services/telemetryService';
import { CacheService } from '../services/cacheService';
import { getClientContext } from '../utils/clientContext';
import { ExplanationResponse, ErrorFixResponse, CompletionResponse } from '../types/api';

export class QuantumHubProvider implements AIProvider {
    private api: QuantumHubApiService;
    private telemetry: TelemetryService;
    private cache: CacheService;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.api = new QuantumHubApiService();
        this.telemetry = TelemetryService.getInstance(context);
        this.cache = CacheService.getInstance(context);
    }

    async explain(code: string, language: string = 'python', errorMessage?: string): Promise<string> {
        const startTime = Date.now();
        
        try {
            const request = {
                code,
                framework: this.detectFramework(code, language),
                detail_level: this.getDetailLevel(),
                include_math: true,
                include_visualization: false,
                client_context: getClientContext(this.context)
            };

            const response = await this.api.explainCode(request);
            
            this.telemetry.trackEvent('explain', {
                duration: Date.now() - startTime,
                language,
                success: true
            });

            return this.formatExplanationResponse(response);
            
        } catch (error) {
            this.telemetry.trackEvent('explain', {
                duration: Date.now() - startTime,
                language,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    async fix(code: string, language: string = 'python', errorMessage?: string): Promise<string> {
        const startTime = Date.now();
        
        try {
            const request = {
                code,
                framework: this.detectFramework(code, language),
                error_message: errorMessage,
                include_explanation: true,
                client_context: getClientContext(this.context)
            };

            const response = await this.api.fixCode(request);
            
            this.telemetry.trackEvent('fix', {
                duration: Date.now() - startTime,
                language,
                issuesCount: response.issues_identified.length,
                success: true
            });

            return response.fixed_code;
            
        } catch (error) {
            this.telemetry.trackEvent('fix', {
                duration: Date.now() - startTime,
                language,
                success: false
            });
            throw error;
        }
    }

    async complete(context: string, language: string = 'python'): Promise<string> {
        const cacheKey = `complete:${language}:${context}`;
        const cached = await this.cache.get<string>(cacheKey);
        if (cached) return cached;

        try {
            const editor = vscode.window.activeTextEditor;
            const position = editor?.selection.active;

            const request = {
                code_prefix: context,
                framework: this.detectFramework(context, language),
                cursor_line: position?.line ?? 0,
                cursor_column: position?.character ?? 0,
                max_suggestions: 1,
                client_context: getClientContext(this.context)
            };

            const response = await this.api.getCompletions(request);
            
            const completion = response.suggestions[0]?.code || '';
            
            if (completion) {
                await this.cache.set(cacheKey, completion, 300000); // 5 minutes
            }
            
            return completion;
            
        } catch (error) {
            this.outputChannel.appendLine(`Completion error: ${error instanceof Error ? error.message : String(error)}`);
            return '';
        }
    }

    async suggest(code: string, language: string = 'python'): Promise<string> {
        // Can be implemented using your backend's fix endpoint with suggestions
        return this.fix(code, language, 'Suggest improvements for this code');
    }

    // Add this method to src/providers/quantumHubProvider.ts

async checkHealth(): Promise<{ healthy: boolean; message: string; version?: string }> {
    try {
        const response = await this.api.checkHealth();
        return {
            healthy: true,
            message: 'Connected',
            version: response.version
        };
    } catch (error) {
        return {
            healthy: false,
            message: error instanceof Error ? error.message : 'Connection failed'
        };
    }
}

    clearCache(): void {
        this.cache.clear();
    }

    private detectFramework(code: string, language: string): string {
        if (language !== 'python') return 'qiskit';
        
        // Detect quantum framework from imports
        if (code.includes('from qiskit') || code.includes('import qiskit')) {
            return 'qiskit';
        } else if (code.includes('import pennylane') || code.includes('from pennylane')) {
            return 'pennylane';
        } else if (code.includes('import cirq') || code.includes('from cirq')) {
            return 'cirq';
        } else if (code.includes('import torchquantum') || code.includes('from torchquantum')) {
            return 'torchquantum';
        }
        
        return 'qiskit'; // default
    }

    private getDetailLevel(): 'beginner' | 'intermediate' | 'advanced' {
        const config = vscode.workspace.getConfiguration('quantum-ai');
        return config.get('explanationDetailLevel', 'intermediate');
    }

    private formatExplanationResponse(response: ExplanationResponse): string {
        let formatted = '';
        
        if (response.overview) {
            formatted += `# Overview\n${response.overview}\n\n`;
        }
        
        if (response.gate_breakdown) {
            formatted += `## Gate Breakdown\n${response.gate_breakdown}\n\n`;
        }
        
        if (response.quantum_concepts) {
            formatted += `## Quantum Concepts\n${response.quantum_concepts}\n\n`;
        }
        
        if (response.mathematics) {
            formatted += `## Mathematical Formulation\n${response.mathematics}\n\n`;
        }
        
        if (response.applications) {
            formatted += `## Applications\n${response.applications}\n`;
        }
        
        return formatted;
    }
}