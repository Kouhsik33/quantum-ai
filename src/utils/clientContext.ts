import * as vscode from 'vscode';
import { ClientContext } from '../types/api';

export function getClientContext(context: vscode.ExtensionContext): ClientContext {
    const extension = vscode.extensions.getExtension('quantumHub.quantum-ai');
    const version = extension?.packageJSON?.version || 'unknown';

    return {
        client_type: 'vscode_extension',
        version,
        platform: process.platform
    };
}

export function getFrameworkFromDocument(document: vscode.TextDocument): string {
    const text = document.getText();
    
    // Detect quantum framework from imports
    if (text.includes('from qiskit') || text.includes('import qiskit')) {
        return 'qiskit';
    } else if (text.includes('import pennylane') || text.includes('from pennylane')) {
        return 'pennylane';
    } else if (text.includes('import cirq') || text.includes('from cirq')) {
        return 'cirq';
    } else if (text.includes('import torchquantum') || text.includes('from torchquantum')) {
        return 'torchquantum';
    }
    
    // Default based on language or config
    const config = vscode.workspace.getConfiguration('quantum-ai');
    const defaultFramework = config.get<string>('framework', 'qiskit');
    
    return defaultFramework === 'auto' ? 'qiskit' : defaultFramework;
}