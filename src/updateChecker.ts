import * as vscode from 'vscode';

export async function checkForUpdates(context: vscode.ExtensionContext) {

    const current = context.extension.packageJSON.version;

    try {
        const res = await fetch(
          "https://api.github.com/repos/Kouhsik33/quantum-ai/releases/latest"
        );

        const json: any = await res.json();
        const latest = json.tag_name.replace("v", "");

        if (latest !== current) {
            vscode.window.showInformationMessage(
                `Quantum AI update available (${latest})`,
                "Download"
            ).then(sel => {
                if (sel === "Download") {
                    vscode.env.openExternal(vscode.Uri.parse(json.html_url));
                }
            });
        }

    } catch {}
}
