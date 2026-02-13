# Quantum AI

Quantum AI is a lightweight coding assistant for VS Code.

## Features

- Explain selected code → Ctrl + K , 
- Fix code errors → Ctrl + .
- Inline AI completion → Tab

## Setup

1. Install extension from VSIX
2. Restart VSCode
3. Set HuggingFace token:

Windows:
setx HF_TOKEN "your_token_here"

Restart VSCode again.

## Notes

The extension sends prompts directly to the model API using your token.
No data is stored by the extension.
