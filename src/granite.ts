import * as vscode from 'vscode';

export interface AIProvider {
    ask(prompt: string): Promise<string>;
    explain(code: string): Promise<string>;
    fix(code: string): Promise<string>;
    complete(context: string): Promise<string>;
}

export class GraniteProvider implements AIProvider {

    private apiKey = process.env.HF_TOKEN;
    private endpoint = "https://router.huggingface.co/v1/chat/completions";
    private model = "Qwen/Qwen2.5-Coder-7B-Instruct";

    constructor() {
        if (!this.apiKey) {
            vscode.window.showErrorMessage("HF_TOKEN not set. Restart VSCode.");
        }
    }

    private async makeRequest(prompt: string): Promise<string> {

        if (!this.apiKey) throw new Error("HF_TOKEN missing");

        try {

            console.log("Quantum-AI request sent");

            const response = await fetch(this.endpoint, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: "system", content: "You are a helpful coding assistant." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.2,
                    max_tokens: 300
                })
            });

            const text = await response.text();
            const data: any = JSON.parse(text);

            if (!response.ok) {
                return `HF Error: ${text}`;
            }

            return data.choices?.[0]?.message?.content?.trim() || "No response";

        } catch (err: any) {
            console.error("HF inference error:", err);
            return "AI request failed";
        }
    }

    ask(prompt: string) { return this.makeRequest(prompt); }

    explain(code: string) {
        return this.makeRequest(`Explain what this code does in simple terms:\n\n${code}`);
    }

    async fix(code: string) {
    const text = await this.makeRequest(
            `Return only corrected code. No explanation.\n\n${code}`
        );
        return cleanCodeBlock(text);
}

    async complete(context: string) {
    const text = await this.makeRequest(
            `Continue this code naturally. Return only code.\n\n${context}`
        );
        return cleanCodeBlock(text);
}

}

function cleanCodeBlock(text: string): string {

    // remove markdown fences
    const codeBlock = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);

    if (codeBlock) {
        return codeBlock[1].trim();
    }

    // remove leading explanations like "Here is the corrected code:"
    return text
        .replace(/^.*?:\n/, '')
        .trim();
}
