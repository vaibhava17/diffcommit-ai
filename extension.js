const vscode = require("vscode");

const PROVIDERS = {
  anthropic: {
    label: "Anthropic Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    needsKey: true,
  },
  openai: {
    label: "OpenAI GPT",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    needsKey: true,
  },
  gemini: {
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"],
    needsKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
  },
  xai: {
    label: "xAI Grok",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-3", "grok-3-mini", "grok-2-latest"],
    needsKey: true,
  },
  mistral: {
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    needsKey: true,
  },
  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    needsKey: true,
  },
  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-sonnet-4.6", "openai/gpt-4o", "google/gemini-2.0-flash-001", "deepseek/deepseek-chat"],
    needsKey: true,
  },
  ollama: {
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "llama3.1", "qwen2.5-coder", "codellama", "mistral"],
    needsKey: false,
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    models: [],
    needsKey: true,
  },
};

const MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT =
  "You write git commit messages from diffs.\n" +
  "Rules:\n" +
  "- Subject line uses Conventional Commits: <type>(<optional scope>): <description>.\n" +
  "- Allowed types: feat, fix, refactor, perf, docs, test, build, ci, chore, style, revert.\n" +
  "- Subject is imperative mood, max 72 characters, no trailing period.\n" +
  "- Describe the meaningful change, not implementation trivia. Never invent changes.\n" +
  "- Return ONLY the commit message. No quotes, no markdown fences, no preamble, no explanation.";

const BODY_RULES =
  "\n- If the diff has more than one notable change, add a blank line after the subject, " +
  "then a body of short '-' bullet points (one per change, wrap at 72 chars). " +
  "If a single small change, return only the subject line.";

const SUBJECT_ONLY_RULES =
  "\n- Return exactly one line: the subject only. If multiple changes exist, pick the most significant one.";

function secretKey(provider) {
  return `aiCommit.apiKey.${provider}`;
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("aiCommit");
  return {
    provider: cfg.get("provider", "anthropic"),
    model: cfg.get("model", "claude-opus-4-8"),
    baseUrl: (cfg.get("baseUrl", "") || "").trim(),
    includeBody: cfg.get("includeBody", true),
    maxDiffChars: cfg.get("maxDiffChars", 60000),
  };
}

// ---------- setup ----------

async function setup(context) {
  const current = getConfig();
  const providerPick = await vscode.window.showQuickPick(
    Object.entries(PROVIDERS).map(([id, p]) => ({
      label: p.label,
      description: id === current.provider ? "current" : undefined,
      id,
    })),
    { placeHolder: "Select AI provider" }
  );
  if (!providerPick) return;
  const providerId = providerPick.id;
  const provider = PROVIDERS[providerId];

  let model;
  if (provider.models.length) {
    const pick = await vscode.window.showQuickPick(
      [...provider.models, "$(edit) Enter custom model..."],
      { placeHolder: "Select model" }
    );
    if (!pick) return;
    model = pick.startsWith("$(edit)")
      ? await vscode.window.showInputBox({ prompt: "Model ID", ignoreFocusOut: true })
      : pick;
  } else {
    model = await vscode.window.showInputBox({ prompt: "Model ID", ignoreFocusOut: true });
  }
  if (!model) return;

  const cfg = vscode.workspace.getConfiguration("aiCommit");
  await cfg.update("provider", providerId, vscode.ConfigurationTarget.Global);
  await cfg.update("model", model.trim(), vscode.ConfigurationTarget.Global);

  if (providerId === "custom" || providerId === "ollama") {
    const baseUrl = await vscode.window.showInputBox({
      prompt: "Base URL (OpenAI-compatible, ends with /v1)",
      value: current.baseUrl || provider.baseUrl || "http://localhost:11434/v1",
      ignoreFocusOut: true,
    });
    if (baseUrl === undefined) return;
    await cfg.update("baseUrl", baseUrl.trim(), vscode.ConfigurationTarget.Global);
  }

  if (provider.needsKey) {
    const existing = await context.secrets.get(secretKey(providerId));
    const key = await vscode.window.showInputBox({
      prompt: `API key for ${provider.label}${existing ? " (leave blank to keep existing)" : ""}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined) return;
    if (key.trim()) await context.secrets.store(secretKey(providerId), key.trim());
  }

  vscode.window.showInformationMessage(`AI Commit: ${provider.label} / ${model} configured ✓`);
}

// ---------- git ----------

function getGitApi() {
  const gitExt = vscode.extensions.getExtension("vscode.git");
  if (!gitExt) throw new Error("Git extension not found");
  const exports = gitExt.isActive ? gitExt.exports : null;
  if (!exports) throw new Error("Git extension not active yet, retry in a moment");
  return exports.getAPI(1);
}

// `arg` is the SourceControl passed by VS Code when invoked from scm/title.
async function pickRepo(arg) {
  const git = getGitApi();
  const repos = git.repositories;
  if (!repos.length) throw new Error("No git repository open");
  if (repos.length === 1) return repos[0];

  const argRoot = arg?.rootUri?.toString();
  if (argRoot) {
    const match = repos.find((r) => r.rootUri.toString() === argRoot);
    if (match) return match;
  }

  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  if (activeUri) {
    const match = repos.find((r) => activeUri.fsPath.startsWith(r.rootUri.fsPath));
    if (match) return match;
  }

  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.rootUri.fsPath.split("/").pop(), description: r.rootUri.fsPath, repo: r })),
    { placeHolder: "Select repository" }
  );
  return pick?.repo;
}

async function getDiff(repo, maxDiffChars) {
  let diff = await repo.diff(true); // staged
  let source = "staged";
  if (!diff?.trim()) {
    diff = await repo.diff(false); // unstaged
    source = "unstaged";
  }
  if (!diff?.trim()) {
    const untracked = repo.state.workingTreeChanges
      .map((c) => vscode.workspace.asRelativePath(c.uri, false))
      .join("\n");
    if (untracked) {
      diff = "New untracked files:\n" + untracked;
      source = "untracked";
    }
  }
  if (!diff?.trim()) throw new Error("No changes found to commit");
  if (diff.length > maxDiffChars) {
    diff = diff.slice(0, maxDiffChars) + "\n\n[diff truncated]";
  }
  return { diff, source };
}

// ---------- providers ----------

async function postJson(url, headers, body, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  return res;
}

async function readError(res, label) {
  let text = await res.text();
  try {
    const j = JSON.parse(text);
    text = j.error?.message || j.message || text;
  } catch {
    /* plain text */
  }
  return new Error(`${label} ${res.status}: ${text.slice(0, 500)}`);
}

async function callAnthropic({ baseUrl, apiKey, model, system, user, signal }) {
  const res = await postJson(
    `${baseUrl}/v1/messages`,
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    { model, max_tokens: MAX_TOKENS, system, messages: [{ role: "user", content: user }] },
    signal
  );
  if (!res.ok) throw await readError(res, "Anthropic");
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// OpenAI reasoning models (o-series, gpt-5) reject `max_tokens`; they want `max_completion_tokens`.
function isOpenAIReasoningModel(providerId, model) {
  return providerId === "openai" && /^(o\d|gpt-5)/.test(model);
}

async function callOpenAICompat({ providerId, baseUrl, apiKey, model, system, user, signal }) {
  const headers = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (providerId === "openrouter") headers["X-Title"] = "DiffCommit AI";

  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  const useCompletionTokens = isOpenAIReasoningModel(providerId, model);
  if (useCompletionTokens) body.max_completion_tokens = MAX_TOKENS;
  else {
    body.max_tokens = MAX_TOKENS;
    body.temperature = 0.2;
  }

  let res = await postJson(`${baseUrl}/chat/completions`, headers, body, signal);
  if (!res.ok && res.status === 400 && !useCompletionTokens) {
    // retry once for endpoints that only accept max_completion_tokens
    const text = await res.clone().text();
    if (/max_completion_tokens/.test(text)) {
      delete body.max_tokens;
      delete body.temperature;
      body.max_completion_tokens = MAX_TOKENS;
      res = await postJson(`${baseUrl}/chat/completions`, headers, body, signal);
    }
  }
  if (!res.ok) throw await readError(res, PROVIDERS[providerId]?.label || "API");
  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (Array.isArray(content)) return content.map((p) => p.text || "").join("");
  return content || "";
}

async function callGemini({ baseUrl, apiKey, model, system, user, signal }) {
  const res = await postJson(
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.2 },
    },
    signal
  );
  if (!res.ok) throw await readError(res, "Gemini");
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

// ---------- message cleanup ----------

function cleanMessage(text, includeBody) {
  let msg = (text || "").replace(/\r\n?/g, "\n");
  msg = msg.replace(/<think>[\s\S]*?<\/think>/gi, "");
  msg = msg.trim();

  // unwrap a single fenced block
  const fence = msg.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  if (fence) msg = fence[1].trim();

  // drop a leading label like "Commit message:"
  msg = msg.replace(/^(commit message|message)\s*:\s*\n?/i, "").trim();

  // unwrap quotes only when the whole thing is one quoted line
  if (!msg.includes("\n")) msg = msg.replace(/^(["'`])(.*)\1$/, "$2").trim();

  let lines = msg.split("\n").map((l) => l.replace(/\s+$/, ""));
  if (!includeBody) lines = lines.slice(0, 1);

  // collapse 3+ blank lines, strip leading/trailing blanks
  msg = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return msg;
}

// ---------- command ----------

async function generate(context, arg) {
  try {
    const cfg = getConfig();
    const providerId = cfg.provider;
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    let apiKey = await context.secrets.get(secretKey(providerId));
    if (provider.needsKey && !apiKey) {
      const choice = await vscode.window.showWarningMessage(
        `No API key set for ${provider.label}.`,
        "Set up now"
      );
      if (choice !== "Set up now") return;
      await setup(context);
      // provider may have changed during setup; re-run with fresh config
      return generate(context, arg);
    }

    const baseUrl = (cfg.baseUrl || provider.baseUrl).replace(/\/+$/, "");
    if (!baseUrl) throw new Error("Base URL not set (aiCommit.baseUrl)");

    const repo = await pickRepo(arg);
    if (!repo) return;
    const { diff, source } = await getDiff(repo, cfg.maxDiffChars);

    const system = SYSTEM_PROMPT + (cfg.includeBody ? BODY_RULES : SUBJECT_ONLY_RULES);
    const user = `Diff (${source} changes):\n\n${diff}`;

    const raw = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `AI Commit: generating with ${cfg.model}...`,
        cancellable: true,
      },
      async (_progress, token) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
        token.onCancellationRequested(() => ac.abort());
        const args = { providerId, baseUrl, apiKey, model: cfg.model, system, user, signal: ac.signal };
        try {
          if (provider.kind === "anthropic") return await callAnthropic(args);
          if (provider.kind === "gemini") return await callGemini(args);
          return await callOpenAICompat(args);
        } catch (err) {
          if (err.name === "AbortError") {
            if (token.isCancellationRequested) return null;
            throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
          }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      }
    );
    if (raw === null) return; // user cancelled

    const message = cleanMessage(raw, cfg.includeBody);
    if (!message) throw new Error("Model returned an empty message");
    repo.inputBox.value = message;
  } catch (err) {
    vscode.window.showErrorMessage(`AI Commit: ${err.message}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCommit.setup", () => setup(context)),
    vscode.commands.registerCommand("aiCommit.generate", (arg) => generate(context, arg))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
