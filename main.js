/**
 * DynamicCodePrime - Electron Main Process
 * ==========================================
 * Natural language to code via dynamic AI prompts
 */

const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { BuilderSessionManager } = require('./lib/builder/session-manager');

let mainWindow;
let appConfig;
let builderManager;
let appSecrets = {};

function getSecretsPath() {
  return path.join(app.getPath('userData'), 'secrets.json');
}

function loadSecrets() {
  try {
    const secretsPath = getSecretsPath();
    if (fs.existsSync(secretsPath)) {
      appSecrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('Failed to load secrets file:', e.message);
    appSecrets = {};
  }
}

function saveSecrets() {
  try {
    const secretsPath = getSecretsPath();
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
    fs.writeFileSync(secretsPath, JSON.stringify(appSecrets, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Failed to save secrets file:', e.message);
  }
}

function getProviderApiKey(provider) {
  const secretKey = appSecrets?.providers?.[provider]?.api_key;
  if (secretKey && String(secretKey).trim()) return secretKey;
  const configKey = appConfig?.[provider]?.api_key;
  if (configKey && String(configKey).trim()) return configKey;
  return '';
}

// ─── Load Config ───────────────────────────────────────────────────────
function loadConfig() {
  const configPath = path.join(__dirname, 'config', 'settings.json');
  loadSecrets();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    appConfig = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load config:', e.message);
    appConfig = {
      ollama_local: { base_url: 'http://localhost:11434', default_model: 'qwen2.5-coder:7b', timeout: 120, max_tokens: 4096, temperature: 0.4 },
      active_provider: 'ollama_local',
      generation: { stream: true, auto_detect_language: true, include_comments: true }
    };
  }
  if (!appConfig.security) {
    appConfig.security = {
      persist_api_keys_in_settings: false,
    };
  }
  // Check for API key: config > ActivatePrimeCOMPLETE fallback > env var
  if (!getProviderApiKey('ollama_cloud')) {
    // Try ActivatePrimeCOMPLETE config
    try {
      const cloudCfgPath = 'G:\\ActivatePrimeCOMPLETE\\config\\ollama_cloud_config.json';
      if (fs.existsSync(cloudCfgPath)) {
        const cloudCfg = JSON.parse(fs.readFileSync(cloudCfgPath, 'utf-8'));
        if (cloudCfg.ollama_cloud?.api_key) {
          if (!appSecrets.providers) appSecrets.providers = {};
          if (!appSecrets.providers.ollama_cloud) appSecrets.providers.ollama_cloud = {};
          appSecrets.providers.ollama_cloud.api_key = cloudCfg.ollama_cloud.api_key;
          saveSecrets();
          console.log('[Config] Loaded Ollama Cloud API key from ActivatePrimeCOMPLETE');
        }
      }
    } catch (e) { /* optional */ }
    // Try environment variable
    if (!getProviderApiKey('ollama_cloud') && process.env.OLLAMA_API_KEY) {
      if (!appSecrets.providers) appSecrets.providers = {};
      if (!appSecrets.providers.ollama_cloud) appSecrets.providers.ollama_cloud = {};
      appSecrets.providers.ollama_cloud.api_key = process.env.OLLAMA_API_KEY;
      saveSecrets();
      console.log('[Config] Loaded Ollama Cloud API key from OLLAMA_API_KEY env');
    }
  } else {
    console.log('[Config] Using Ollama Cloud API key from settings.json');
  }
  return appConfig;
}

// ─── Create Window ─────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DynamicCodePrime',
    backgroundColor: '#0a0a0f',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'src', 'assets', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Resolve Ollama Cloud model name to tagged form (e.g. qwen3-coder-next → qwen3-coder-next:cloud)
function resolveCloudModelName(shortName) {
  if (!shortName || shortName.includes(':')) return shortName;
  const paths = [
    path.join(__dirname, '..', 'ActivatePrimeCOMPLETE', 'config', 'ollama_cloud_config.json'),
    'G:\\ActivatePrimeCOMPLETE\\config\\ollama_cloud_config.json'
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const sizes = json?.cloud_models?.[shortName]?.sizes;
        if (Array.isArray(sizes) && sizes.length > 0 && typeof sizes[0] === 'string') {
          const resolved = `${shortName}:${sizes[0]}`;
          console.log('[Ollama Cloud] Resolved model:', shortName, '->', resolved);
          return resolved;
        }
      }
    } catch (e) { /* ignore */ }
  }
  // Fallback: cloud-only models often use :cloud tag
  const needsCloud = ['qwen3-coder-next', 'qwen3-next', 'deepseek-v3.2', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'kimi-k2', 'kimi-k2-thinking', 'glm-4.6', 'glm-4.7', 'minimax-m2', 'minimax-m2.1', 'mistral-large-3', 'nemotron-3-nano', 'devstral-small-2', 'devstral-2', 'ministral-3', 'rnj-1', 'cogito-2.1'];
  if (needsCloud.some(m => shortName === m || shortName.startsWith(m + ':'))) return `${shortName}:cloud`;
  return `${shortName}:latest`;
}

// ─── Ollama API Call (streaming) ───────────────────────────────────────
function buildOllamaRequest(prompt, language, context, model) {
  const provider = appConfig.active_provider || 'ollama_local';
  const cfg = appConfig[provider] || appConfig.ollama_local;
  let chosenModel = model || cfg.default_model;
  if (provider === 'ollama_cloud') chosenModel = resolveCloudModelName(chosenModel);

  const systemPrompt = `You are DynamicCodePrime, an expert code generator. The user describes what they want in natural language and you produce clean, production-ready code.

RULES:
- Output ONLY the code. No explanations, no markdown fences, no commentary.
- Use the target language: ${language || 'auto-detect from the prompt'}.
- Write clean, well-structured, properly indented code.
- Include brief inline comments for complex logic.
- If the user says "modify" or "update", treat the CONTEXT as existing code to modify.
- Follow modern best practices for the chosen language/framework.`;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (context && context.trim()) {
    messages.push({ role: 'user', content: `Here is the existing code context:\n\`\`\`\n${context}\n\`\`\`` });
    messages.push({ role: 'assistant', content: 'I see the existing code. What would you like me to do with it?' });
  }

  messages.push({ role: 'user', content: prompt });

  return {
    url: cfg.base_url,
    model: chosenModel,
    messages,
    temperature: cfg.temperature || 0.4,
    max_tokens: cfg.max_tokens || 4096,
    api_key: getProviderApiKey(provider) || null,
    timeout: (cfg.timeout || 120) * 1000
  };
}

// Stream from Ollama (local or cloud)
function streamOllama(requestId, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(params.url + '/api/chat');
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;

    const body = JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
      options: {
        temperature: params.temperature,
        num_predict: params.max_tokens
      }
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (params.api_key) {
      headers['Authorization'] = `Bearer ${params.api_key}`;
    }

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers,
      timeout: params.timeout
    };

    const req = transport.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', d => errBody += d);
        res.on('end', () => {
          const msg = res.statusCode === 401
            ? 'Invalid or missing Ollama API key. Add your key in Settings.'
            : `Ollama API error ${res.statusCode}: ${errBody}`;
          reject(new Error(msg));
        });
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message && data.message.content) {
              // Send token to renderer
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:token', { requestId, token: data.message.content });
              }
            }
            if (data.done) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:done', {
                  requestId,
                  total_duration: data.total_duration,
                  eval_count: data.eval_count
                });
              }
            }
          } catch (e) { /* skip malformed */ }
        }
      });

      res.on('end', () => resolve());
      res.on('error', (e) => reject(e));
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── OpenAI API Call (streaming) ───────────────────────────────────────
function buildOpenAIRequest(prompt, language, context, model) {
  const cfg = appConfig.openai || {};
  const chosenModel = model || cfg.default_model || 'gpt-5.2';

  const systemPrompt = `You are DynamicCodePrime, an expert code generator. The user describes what they want in natural language and you produce clean, production-ready code.

RULES:
- Output ONLY the code. No explanations, no markdown fences, no commentary.
- Use the target language: ${language || 'auto-detect from the prompt'}.
- Write clean, well-structured, properly indented code.
- Include brief inline comments for complex logic.
- If the user says "modify" or "update", treat the CONTEXT as existing code to modify.
- Follow modern best practices for the chosen language/framework.`;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (context && context.trim()) {
    messages.push({ role: 'user', content: `Here is the existing code context:\n\`\`\`\n${context}\n\`\`\`` });
    messages.push({ role: 'assistant', content: 'I see the existing code. What would you like me to do with it?' });
  }

  messages.push({ role: 'user', content: prompt });

  return {
    url: cfg.base_url || 'https://api.openai.com',
    model: chosenModel,
    messages,
    temperature: cfg.temperature || 0.4,
    max_tokens: cfg.max_tokens || 4096,
    api_key: getProviderApiKey('openai') || null,
    timeout: (cfg.timeout || 180) * 1000
  };
}

function streamOpenAI(requestId, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(params.url + '/v1/chat/completions');

    const body = JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      stream: true
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${params.api_key}`
    };

    const reqOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers,
      timeout: params.timeout
    };

    const req = https.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', d => errBody += d);
        res.on('end', () => {
          const msg = res.statusCode === 401
            ? 'Invalid or missing OpenAI API key. Add your key in Settings.'
            : `OpenAI API error ${res.statusCode}: ${errBody}`;
          reject(new Error(msg));
        });
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('ai:done', { requestId });
            }
            continue;
          }

          try {
            const data = JSON.parse(jsonStr);
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:token', { requestId, token: delta.content });
              }
            }
          } catch (e) { /* skip malformed SSE */ }
        }
      });

      res.on('end', () => resolve());
      res.on('error', (e) => reject(e));
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI request timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── Anthropic API Call (streaming) ────────────────────────────────────
function buildAnthropicRequest(prompt, language, context, model) {
  const cfg = appConfig.anthropic || {};
  const chosenModel = model || cfg.default_model || 'claude-opus-4-6';

  const systemPrompt = `You are DynamicCodePrime, an expert code generator. The user describes what they want in natural language and you produce clean, production-ready code.

RULES:
- Output ONLY the code. No explanations, no markdown fences, no commentary.
- Use the target language: ${language || 'auto-detect from the prompt'}.
- Write clean, well-structured, properly indented code.
- Include brief inline comments for complex logic.
- If the user says "modify" or "update", treat the CONTEXT as existing code to modify.
- Follow modern best practices for the chosen language/framework.`;

  const messages = [];

  if (context && context.trim()) {
    messages.push({ role: 'user', content: `Here is the existing code context:\n\`\`\`\n${context}\n\`\`\`` });
    messages.push({ role: 'assistant', content: 'I see the existing code. What would you like me to do with it?' });
  }

  messages.push({ role: 'user', content: prompt });

  return {
    url: cfg.base_url || 'https://api.anthropic.com',
    model: chosenModel,
    system: systemPrompt,
    messages,
    temperature: cfg.temperature || 0.4,
    max_tokens: cfg.max_tokens || 4096,
    api_key: getProviderApiKey('anthropic') || null,
    timeout: (cfg.timeout || 180) * 1000
  };
}

function streamAnthropic(requestId, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(params.url + '/v1/messages');

    const body = JSON.stringify({
      model: params.model,
      system: params.system,
      messages: params.messages,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      stream: true
    });

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key': params.api_key,
      'anthropic-version': '2023-06-01'
    };

    const reqOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers,
      timeout: params.timeout
    };

    const req = https.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', d => errBody += d);
        res.on('end', () => {
          const msg = res.statusCode === 401
            ? 'Invalid or missing Anthropic API key. Add your key in Settings.'
            : `Anthropic API error ${res.statusCode}: ${errBody}`;
          reject(new Error(msg));
        });
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);

            // content_block_delta contains streaming text
            if (data.type === 'content_block_delta' && data.delta?.text) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:token', { requestId, token: data.delta.text });
              }
            }

            // message_stop = stream finished
            if (data.type === 'message_stop') {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:done', { requestId });
              }
            }

            // message_delta has usage stats
            if (data.type === 'message_delta' && data.usage) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:done', {
                  requestId,
                  eval_count: data.usage.output_tokens
                });
              }
            }
          } catch (e) { /* skip malformed SSE */ }
        }
      });

      res.on('end', () => resolve());
      res.on('error', (e) => reject(e));
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Anthropic request timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────────
function setupIPC() {
  if (!builderManager) {
    builderManager = new BuilderSessionManager({
      storagePath: path.join(app.getPath('userData'), 'builder-sessions.json'),
      maxLogEntries: appConfig?.builder?.max_log_entries || 400,
    });
  }
  builderManager.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('builder:event', event);
    }
  });

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Save an API key for a provider (persists to settings.json + updates in-memory)
  ipcMain.handle('config:setApiKey', async (_, { provider, apiKey }) => {
    const allowed = ['openai', 'anthropic', 'ollama_cloud'];
    if (!allowed.includes(provider)) return { success: false, error: 'Invalid provider' };
    if (!appConfig[provider]) appConfig[provider] = {};
    if (!appSecrets.providers) appSecrets.providers = {};
    if (!appSecrets.providers[provider]) appSecrets.providers[provider] = {};
    appSecrets.providers[provider].api_key = apiKey;
    saveSecrets();
    if (!appConfig[provider]) appConfig[provider] = {};
    appConfig[provider].api_key = '';

    const configPath = path.join(__dirname, 'config', 'settings.json');
    try {
      const shouldPersistInSettings = Boolean(appConfig?.security?.persist_api_keys_in_settings);
      if (shouldPersistInSettings) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const json = JSON.parse(raw);
        if (!json[provider]) json[provider] = {};
        json[provider].api_key = apiKey;
        fs.writeFileSync(configPath, JSON.stringify(json, null, 2), 'utf-8');
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Get config
  ipcMain.handle('config:get', () => {
    return {
      ...appConfig,
      // Scrub API keys for renderer but indicate if set
      openai: {
        ...appConfig.openai,
        api_key: appConfig.openai?.api_key ? '***configured***' : '',
        has_key: !!getProviderApiKey('openai')
      },
      anthropic: {
        ...appConfig.anthropic,
        api_key: appConfig.anthropic?.api_key ? '***configured***' : '',
        has_key: !!getProviderApiKey('anthropic')
      },
      ollama_cloud: {
        ...appConfig.ollama_cloud,
        api_key: appConfig.ollama_cloud?.api_key ? '***configured***' : '',
        has_key: !!getProviderApiKey('ollama_cloud')
      }
    };
  });

  // Update active provider
  ipcMain.handle('config:setProvider', (_, provider) => {
    appConfig.active_provider = provider;
    return { success: true, provider };
  });

  // Update active model
  ipcMain.handle('config:setModel', (_, model) => {
    const provider = appConfig.active_provider || 'ollama_local';
    appConfig[provider].default_model = model;
    return { success: true, model };
  });

  // Generate code (streaming) - routes to correct provider
  ipcMain.handle('ai:generate', async (_, { prompt, language, context, model, requestId }) => {
    const provider = appConfig.active_provider || 'ollama_local';
    try {
      // Require API key for cloud providers
      if (provider === 'ollama_cloud') {
        const key = getProviderApiKey('ollama_cloud');
        if (!key || !String(key).trim()) {
          throw new Error('Ollama Cloud requires an API key. Add it in Settings.');
        }
      }
      if (provider === 'openai') {
        const key = getProviderApiKey('openai');
        if (!key || !String(key).trim()) {
          throw new Error('OpenAI requires an API key. Add it in Settings.');
        }
        const params = buildOpenAIRequest(prompt, language, context, model);
        mainWindow.webContents.send('ai:start', { requestId, model: params.model });
        await streamOpenAI(requestId, params);
      } else if (provider === 'anthropic') {
        const key = getProviderApiKey('anthropic');
        if (!key || !String(key).trim()) {
          throw new Error('Anthropic requires an API key. Add it in Settings.');
        }
        const params = buildAnthropicRequest(prompt, language, context, model);
        mainWindow.webContents.send('ai:start', { requestId, model: params.model });
        await streamAnthropic(requestId, params);
      } else {
        const params = buildOllamaRequest(prompt, language, context, model);
        mainWindow.webContents.send('ai:start', { requestId, model: params.model });
        await streamOllama(requestId, params);
      }
      return { success: true };
    } catch (e) {
      mainWindow.webContents.send('ai:error', { requestId, error: e.message });
      return { success: false, error: e.message };
    }
  });

  // Check connectivity for active provider
  ipcMain.handle('ai:checkConnection', async () => {
    const provider = appConfig.active_provider || 'ollama_local';

    // OpenAI / Anthropic: just check if key is configured
    if (provider === 'openai') {
      const hasKey = !!getProviderApiKey('openai');
      return { connected: hasKey, provider, status: hasKey ? 'API key configured' : 'No API key' };
    }
    if (provider === 'anthropic') {
      const hasKey = !!getProviderApiKey('anthropic');
      return { connected: hasKey, provider, status: hasKey ? 'API key configured' : 'No API key' };
    }

    // Ollama (local or cloud)
    const cfg = appConfig[provider] || appConfig.ollama_local;
    return new Promise((resolve) => {
      const urlObj = new URL(cfg.base_url);
      const transport = urlObj.protocol === 'https:' ? https : http;
      const headers = {};
      const providerKey = getProviderApiKey(provider);
      if (providerKey) headers['Authorization'] = `Bearer ${providerKey}`;
      const req = transport.get(cfg.base_url, { timeout: 5000, headers }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ connected: res.statusCode === 200, provider, status: res.statusCode }));
      });
      req.on('error', (e) => resolve({ connected: false, provider, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ connected: false, provider, error: 'Timeout' }); });
    });
  });

  // List local models
  ipcMain.handle('ai:listModels', async () => {
    const cfg = appConfig.ollama_local;
    return new Promise((resolve) => {
      const req = http.get(`${cfg.base_url}/api/tags`, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve({ models: (data.models || []).map(m => m.name) });
          } catch { resolve({ models: [] }); }
        });
      });
      req.on('error', () => resolve({ models: [] }));
      req.on('timeout', () => { req.destroy(); resolve({ models: [] }); });
    });
  });

  // Clipboard
  ipcMain.handle('clipboard:write', (_, text) => { clipboard.writeText(text); return true; });

  // Save file
  ipcMain.handle('file:save', async (_, { content, language }) => {
    const extMap = {
      javascript: 'js', typescript: 'ts', python: 'py', java: 'java',
      csharp: 'cs', cpp: 'cpp', c: 'c', go: 'go', rust: 'rs',
      html: 'html', css: 'css', ruby: 'rb', php: 'php', swift: 'swift',
      kotlin: 'kt', sql: 'sql', bash: 'sh', powershell: 'ps1', json: 'json'
    };
    const ext = extMap[language] || 'txt';
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `generated_code.${ext}`,
      filters: [{ name: 'Code Files', extensions: [ext] }, { name: 'All Files', extensions: ['*'] }]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { saved: true, path: result.filePath };
    }
    return { saved: false };
  });

  // Pick folder
  ipcMain.handle('file:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select target folder for staged build',
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { selected: false, path: '' };
    }
    return { selected: true, path: result.filePaths[0] };
  });

  // Builder orchestrator handlers
  ipcMain.handle('builder:scanTarget', async (_, { targetPath }) => {
    try {
      const result = await builderManager.scanTarget(targetPath);
      return { success: true, ...result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:createSession', async (_, payload) => {
    try {
      const session = await builderManager.createSession(payload || {});
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:start', async (_, { sessionId }) => {
    try {
      const session = await builderManager.start(sessionId);
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:approveStage', async (_, { sessionId }) => {
    try {
      const session = await builderManager.approveStage(sessionId);
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:requestEnhancement', async (_, { sessionId, enhancementPrompt }) => {
    try {
      const session = await builderManager.requestEnhancement(sessionId, { enhancementPrompt });
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:retryStage', async (_, { sessionId }) => {
    try {
      const session = await builderManager.retryStage(sessionId);
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:cancel', async (_, { sessionId }) => {
    try {
      const session = builderManager.cancel(sessionId);
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:getSession', async (_, { sessionId }) => {
    try {
      const session = builderManager.getSession(sessionId);
      return { success: true, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('builder:listSessions', async () => {
    try {
      return { success: true, sessions: builderManager.listSessions() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

// ─── App Lifecycle ─────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  setupIPC();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });
