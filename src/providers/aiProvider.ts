// Abstract AI provider interface
// export interface AIProvider {
//     explain(code: string, language?: string, errorMessage?: string): Promise<string>;
//     fix(code: string, language?: string, errorMessage?: string): Promise<string>;
//     complete(context: string, language?: string): Promise<string>;
//     suggest(code: string, language?: string): Promise<string>;
//     clearCache?(): void;
// }


// src/providers/aiProvider.ts
import { SuggestionResult } from './quantumHubProvider';

// Abstract AI provider interface
export interface AIProvider {
    explain(code: string, language?: string, errorMessage?: string): Promise<string>;
    fix(code: string, language?: string, errorMessage?: string): Promise<string>;
    complete(context: string, language?: string): Promise<string>;
    suggest(code: string, language?: string): Promise<SuggestionResult>;
    clearCache?(): void;
    checkHealth?(): Promise<{ healthy: boolean; message: string; version?: string }>;
}

// src/providers/aiProvider.ts
// export interface AIProvider {
//     explain(code: string, language?: string, errorMessage?: string): Promise<string>;
//     fix(code: string, language?: string, errorMessage?: string): Promise<string>;
//     complete(context: string, language?: string): Promise<string>;
//     suggest(code: string, language?: string): Promise<{code: string; explanation: string}>; // Updated return type
//     clearCache?(): void;
// }