# How DynamicCodePrime Is Hooked Up

## Architecture (Electron)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RENDERER (src/index.html + src/js/renderer.js)                         │
│  - UI: provider dropdown, model dropdown, prompt, context, Generate       │
│  - state.config from getConfig()                                         │
│  - On Generate: window.api.generate({ prompt, language, context, model }) │
│    where model = els.modelSelect.value (e.g. "qwen3-coder-next")         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    preload.js (contextBridge)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MAIN (main.js)                                                          │
│  - loadConfig() → config/settings.json (+ optional ActivatePrime key)   │
│  - IPC: config:get, config:setProvider, config:setModel                 │
│  - IPC: ai:generate → buildOllamaRequest() → streamOllama()              │
│  - streamOllama: POST to cfg.base_url + '/api/chat'                      │
│    body: { model, messages, stream: true, options }                      │
│    headers: Authorization Bearer api_key when cloud                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                         HTTP/HTTPS (Node http/https)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  OLLAMA                                                                  │
│  - Local: http://localhost:11434/api/chat   (model e.g. qwen2.5-coder:7b) │
│  - Cloud: https://ollama.com/api/chat      (model must be e.g.          │
│            qwen3-coder-next:cloud, qwen3-next:80b, etc.)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## Config flow

| What | Where |
|------|--------|
| **Provider / model** | `config/settings.json` → `active_provider`, `ollama_cloud.default_model`, `available_models.cloud` |
| **Ollama Cloud API key** | 1) `settings.json` `ollama_cloud.api_key` 2) `G:\ActivatePrimeCOMPLETE\config\ollama_cloud_config.json` 3) env `OLLAMA_API_KEY` |

## Data flow for “Generate”

1. User picks **Ollama Cloud** and model **qwen3-coder-next** in the UI.
2. **Renderer** calls `api.generate({ prompt, language, context, model: 'qwen3-coder-next' })`.
3. **Main** `ai:generate` handler:
   - `buildOllamaRequest(..., model)` → `params.model = model || cfg.default_model` (still `qwen3-coder-next`).
   - `streamOllama(requestId, params)` → POST `https://ollama.com/api/chat` with `model: "qwen3-coder-next"` and `Authorization: Bearer <key>`.
4. **Ollama Cloud** expects a **tagged** name (e.g. `qwen3-coder-next:cloud`). If you send only `qwen3-coder-next`, the request can fail with “model not found” / not available.

So the fix is in **main.js**: when provider is `ollama_cloud`, resolve the display name to the tagged name (e.g. from config or a known map) before calling `streamOllama`.

## Files

| File | Role |
|------|------|
| `main.js` | Config load, IPC, `buildOllamaRequest`, `streamOllama` (and OpenAI/Anthropic). |
| `preload.js` | Exposes `api.getConfig`, `api.setModel`, `api.generate`, etc. |
| `src/js/renderer.js` | DOM, `getConfig`/`applyConfig`, `updateModelDropdown`, `generate()` → `api.generate()`. |
| `config/settings.json` | Providers, default_model, available_models, API keys. |
