# DiffCommit AI

<p align="center"><img src="images/icon.png" width="128" alt="DiffCommit AI"></p>

Generate git commit messages from your diff using any major AI provider. Conventional Commits subject + optional bullet-point body.

## Supported providers

- Anthropic Claude
- OpenAI GPT (incl. o-series reasoning models)
- Google Gemini
- DeepSeek
- xAI Grok
- Mistral
- Groq
- OpenRouter
- Ollama (local, no API key)
- Any custom OpenAI-compatible endpoint

## Usage

1. Run command: **AI Commit: Select Provider, Model & API Key** (Cmd+Shift+P)
2. Pick provider → pick model → paste API key (stored securely in VS Code SecretStorage)
3. Click the ✨ sparkle button in the Source Control title bar
4. Commit message appears in the message box — edit if needed, commit

Staged changes are used first; falls back to unstaged, then to a list of untracked files.
Multi-root workspaces: the repo is picked from the SCM view you clicked, else the active file.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `aiCommit.provider` | `anthropic` | Provider id |
| `aiCommit.model` | `claude-opus-4-8` | Model id |
| `aiCommit.baseUrl` | `""` | Override base URL (required for `custom`, optional for `ollama`) |
| `aiCommit.includeBody` | `true` | Allow a multi-line body below the subject. `false` = subject only |
| `aiCommit.maxDiffChars` | `60000` | Diff truncated to this length before sending |
