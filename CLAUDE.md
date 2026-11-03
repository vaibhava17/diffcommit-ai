# DiffCommit AI — VS Code Extension

Multi-provider AI commit message generator (`vaibhava17.ai-commit-msg`), published on VS Marketplace.

## Stack

- Plain JS, zero runtime deps (global `fetch`)
- `extension.js` — all logic (providers, git diff, SCM inputBox)
- `package.json` — commands, scm/title menu, settings

## Providers

Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral, Groq, OpenRouter, Ollama (local), custom. Most use OpenAI-compatible `/chat/completions`; Anthropic + Gemini have own handlers. API keys in SecretStorage (`aiCommit.apiKey.<provider>`).

## Release

1. Bump `version` in package.json
2. `npx @vscode/vsce package`
3. Upload .vsix at marketplace.visualstudio.com/manage (publisher `vaibhava17`) or `npx vsce publish`

## Notes

- Display name "AI Commit Message" was taken — do not rename back
- Diff capped at 60k chars
- Icon: `images/icon.png` (256px, source `images/icon.svg`)
- Never commit/push/publish here - user reviews + commits themselves
- CI: `.github/workflows/publish.yml` publishes on push to master when version changed to VS Marketplace (`VSCE_PAT`) + Open VSX (`OVSX_PAT`, optional)
