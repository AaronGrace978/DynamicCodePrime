/**
 * DynamicCodePrime - Renderer (Main UI Logic)
 * =============================================
 * Handles all UI interactions, AI streaming, code display,
 * dynamic prompts, and the full user experience.
 */

// ─── State ─────────────────────────────────────────────────────────────
const state = {
  isGenerating: false,
  currentRequestId: null,
  generatedCode: '',
  currentLanguage: 'auto',
  detectedLanguage: null,
  config: null,
  promptEngine: new DynamicPromptEngine(),
  history: [],
};

// ─── DOM Elements ──────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  // Titlebar
  btnMinimize: $('#btnMinimize'),
  btnMaximize: $('#btnMaximize'),
  btnClose: $('#btnClose'),
  connectionStatus: $('#connectionStatus'),

  // Config
  btnSettings: $('#btnSettings'),
  languageSelect: $('#languageSelect'),
  providerSelect: $('#providerSelect'),
  modelSelect: $('#modelSelect'),

  // Prompt
  promptInput: $('#promptInput'),
  promptSuggestions: $('#promptSuggestions'),
  contextInput: $('#contextInput'),
  contextBadge: $('#contextBadge'),
  btnClearPrompt: $('#btnClearPrompt'),
  btnGenerate: $('#btnGenerate'),
  btnStop: $('#btnStop'),
  historyList: $('#historyList'),

  // Code
  codePlaceholder: $('#codePlaceholder'),
  codeOutput: $('#codeOutput'),
  codeContent: $('#codeContent'),
  lineNumbers: $('#lineNumbers'),
  codeLangBadge: $('#codeLangBadge'),
  codeCursor: $('#codeCursor'),
  btnCopy: $('#btnCopy'),
  btnSave: $('#btnSave'),
  btnClearCode: $('#btnClearCode'),

  // Status
  statusProviderText: $('#statusProviderText'),
  statusModelText: $('#statusModelText'),
  statusTokens: $('#statusTokens'),
  statusTime: $('#statusTime'),

  // Panel resizer
  panelResizer: $('#panelResizer'),
  promptPanel: $('#promptPanel'),

  // Toast
  toastContainer: $('#toastContainer'),
};

// ─── Initialize ────────────────────────────────────────────────────────
async function init() {
  setupWindowControls();
  setupPanelResizer();
  setupPromptInput();
  setupChips();
  setupCodeActions();
  setupKeyboard();
  setupContextInput();

  // Load config
  state.config = await window.api.getConfig();
  applyConfig(state.config);

  // Check connection
  checkConnection();

  // Load local models
  loadModels();

  console.log('[DCP] DynamicCodePrime initialized');
}

// ─── Window Controls ───────────────────────────────────────────────────
function setupWindowControls() {
  els.btnMinimize.addEventListener('click', () => window.api.minimize());
  els.btnMaximize.addEventListener('click', () => window.api.maximize());
  els.btnClose.addEventListener('click', () => window.api.close());
}

// ─── Panel Resizer ─────────────────────────────────────────────────────
function setupPanelResizer() {
  let isResizing = false;
  let startX, startWidth;

  els.panelResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = els.promptPanel.offsetWidth;
    els.panelResizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dx = e.clientX - startX;
    const newWidth = Math.max(320, Math.min(startWidth + dx, window.innerWidth - 400));
    els.promptPanel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      els.panelResizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ─── Config ────────────────────────────────────────────────────────────
function applyConfig(config) {
  if (!config) return;

  // Set provider dropdown
  els.providerSelect.value = config.active_provider || 'ollama_local';
  updateProviderUI(config.active_provider);

  // Settings modal
  if (els.btnSettings) {
    els.btnSettings.addEventListener('click', () => openSettingsModal());
  }

  // Provider change
  els.providerSelect.addEventListener('change', async () => {
    const provider = els.providerSelect.value;
    await window.api.setProvider(provider);
    state.config.active_provider = provider;
    updateProviderUI(provider);
    updateModelDropdown(provider);
    checkConnection();
  });

  // Model change
  els.modelSelect.addEventListener('change', async () => {
    const model = els.modelSelect.value;
    await window.api.setModel(model);
    els.statusModelText.textContent = model;
  });

  // Language change
  els.languageSelect.addEventListener('change', () => {
    state.currentLanguage = els.languageSelect.value;
  });

  updateModelDropdown(config.active_provider);
}

function updateProviderUI(provider) {
  const names = { ollama_local: 'Ollama Local', ollama_cloud: 'Ollama Cloud', openai: 'OpenAI', anthropic: 'Anthropic Claude' };
  els.statusProviderText.textContent = names[provider] || provider;
}

function updateModelDropdown(provider) {
  const config = state.config;
  if (!config || !config.available_models) return;

  const modelTypeMap = { ollama_cloud: 'cloud', ollama_local: 'local', openai: 'openai', anthropic: 'anthropic' };
  const modelType = modelTypeMap[provider] || 'local';
  const models = config.available_models[modelType] || [];

  els.modelSelect.innerHTML = '';
  for (const model of models) {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    els.modelSelect.appendChild(opt);
  }

  // Set default
  const defaultModel = config[provider]?.default_model;
  if (defaultModel) {
    els.modelSelect.value = defaultModel;
    els.statusModelText.textContent = defaultModel;
  } else if (models.length > 0) {
    els.statusModelText.textContent = models[0];
  }
}

async function loadModels() {
  try {
    const result = await window.api.listModels();
    if (result.models && result.models.length > 0) {
      // Add discovered local models
      const existing = new Set(state.config?.available_models?.local || []);
      for (const m of result.models) {
        if (!existing.has(m)) {
          state.config.available_models.local.push(m);
        }
      }
      if (state.config.active_provider === 'ollama_local') {
        updateModelDropdown('ollama_local');
      }
    }
  } catch (e) { /* ok */ }
}

async function checkConnection() {
  const statusDot = els.connectionStatus.querySelector('.status-dot');
  const statusText = els.connectionStatus.querySelector('.status-text');

  statusDot.className = 'status-dot';
  statusText.textContent = 'Connecting...';

  try {
    const result = await window.api.checkConnection();
    if (result.connected) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
    } else {
      statusDot.classList.add('error');
      statusText.textContent = 'Disconnected';
      showToast('Cannot connect to Ollama. Make sure it is running.', 'error');
    }
  } catch (e) {
    statusDot.classList.add('error');
    statusText.textContent = 'Error';
  }
}

// ─── Prompt Input & Dynamic Suggestions ────────────────────────────────
function setupPromptInput() {
  let debounceTimer;

  els.promptInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const text = els.promptInput.value;
      if (text.length >= 3) {
        showSuggestions(text);
      } else {
        hideSuggestions();
      }

      // Auto-detect language
      if (state.currentLanguage === 'auto' && text.length > 10) {
        const detected = state.promptEngine.detectLanguage(text);
        if (detected) {
          state.detectedLanguage = detected;
        }
      }
    }, 300);
  });

  els.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  els.promptInput.addEventListener('blur', () => {
    // Delay to allow clicking suggestions
    setTimeout(hideSuggestions, 200);
  });

  els.btnClearPrompt.addEventListener('click', () => {
    els.promptInput.value = '';
    hideSuggestions();
    els.promptInput.focus();
  });

  els.btnGenerate.addEventListener('click', () => generate());
}

function showSuggestions(text) {
  const suggestions = state.promptEngine.getSuggestions(text, state.currentLanguage);
  if (suggestions.length === 0) {
    hideSuggestions();
    return;
  }

  els.promptSuggestions.innerHTML = '';
  for (const suggestion of suggestions) {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.innerHTML = `<span class="suggestion-type">${suggestion.category}</span>${escapeHtml(suggestion.text)}`;
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      els.promptInput.value = suggestion.text;
      hideSuggestions();
      els.promptInput.focus();
      // Place cursor at first {{}} placeholder
      const match = suggestion.text.match(/\{\{(\w+)\}\}/);
      if (match) {
        const idx = suggestion.text.indexOf(match[0]);
        els.promptInput.setSelectionRange(idx, idx + match[0].length);
      }
    });
    els.promptSuggestions.appendChild(div);
  }

  els.promptSuggestions.classList.add('visible');
}

function hideSuggestions() {
  els.promptSuggestions.classList.remove('visible');
}

// ─── Template Chips ────────────────────────────────────────────────────
function setupChips() {
  for (const chip of $$('.chip')) {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      els.promptInput.value = prompt;
      els.promptInput.focus();
      // Move cursor to end
      els.promptInput.setSelectionRange(prompt.length, prompt.length);
    });
  }
}

// ─── Context Input ─────────────────────────────────────────────────────
function setupContextInput() {
  els.contextInput.addEventListener('input', () => {
    const hasContent = els.contextInput.value.trim().length > 0;
    els.contextBadge.textContent = hasContent ? 'has code' : 'empty';
    els.contextBadge.classList.toggle('has-context', hasContent);
  });
}

// ─── Code Actions ──────────────────────────────────────────────────────
function setupCodeActions() {
  els.btnCopy.addEventListener('click', async () => {
    if (!state.generatedCode) return;
    await window.api.copyToClipboard(state.generatedCode);
    showToast('Code copied to clipboard!', 'success');
  });

  els.btnSave.addEventListener('click', async () => {
    if (!state.generatedCode) return;
    const lang = state.detectedLanguage || state.currentLanguage || 'txt';
    const result = await window.api.saveFile(state.generatedCode, lang);
    if (result.saved) {
      showToast(`Saved to ${result.path}`, 'success');
    }
  });

  els.btnClearCode.addEventListener('click', () => {
    state.generatedCode = '';
    els.codeContent.textContent = '';
    els.lineNumbers.innerHTML = '';
    els.codeOutput.style.display = 'none';
    els.codePlaceholder.style.display = 'flex';
    els.codeLangBadge.textContent = '';
  });
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter = Generate
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
    // Escape = Stop generation
    if (e.key === 'Escape' && state.isGenerating) {
      stopGeneration();
    }
  });
}

// ─── AI Generation ─────────────────────────────────────────────────────
let generationStartTime = 0;
let tokenCount = 0;

async function generate() {
  const rawPrompt = els.promptInput.value.trim();
  if (!rawPrompt || state.isGenerating) return;

  // Enhance prompt
  const language = state.currentLanguage !== 'auto' ? state.currentLanguage : state.detectedLanguage;
  const prompt = state.promptEngine.enhancePrompt(rawPrompt, language, null);
  const context = els.contextInput.value.trim();

  // Save to history
  state.promptEngine.addToHistory(rawPrompt);
  addHistoryItem(rawPrompt);

  // Reset code display
  state.generatedCode = '';
  tokenCount = 0;
  generationStartTime = Date.now();
  els.codeContent.textContent = '';
  els.lineNumbers.innerHTML = '';
  els.codePlaceholder.style.display = 'none';
  els.codeOutput.style.display = 'flex';
  els.codeCursor.classList.add('active');

  // Set loading state
  setGenerating(true);

  // Request ID
  state.currentRequestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  try {
    await window.api.generate({
      prompt,
      language: language || 'auto',
      context,
      model: els.modelSelect.value,
      requestId: state.currentRequestId
    });
  } catch (e) {
    showToast('Generation failed: ' + e.message, 'error');
    setGenerating(false);
  }
}

function stopGeneration() {
  // Currently we just reset UI - full cancellation would need AbortController in main
  setGenerating(false);
  state.currentRequestId = null;
  els.codeCursor.classList.remove('active');
  showToast('Generation stopped', 'info');
}

function setGenerating(generating) {
  state.isGenerating = generating;
  els.btnGenerate.classList.toggle('loading', generating);
  els.btnStop.style.display = generating ? 'flex' : 'none';
  els.btnGenerate.disabled = generating;
}

// ─── AI Streaming Handlers ─────────────────────────────────────────────
window.api.onStart(({ requestId, model }) => {
  if (requestId !== state.currentRequestId) return;
  els.statusModelText.textContent = model;
});

window.api.onToken(({ requestId, token }) => {
  if (requestId !== state.currentRequestId) return;

  state.generatedCode += token;
  tokenCount++;

  // Update code display with syntax highlighting
  renderCode(state.generatedCode);

  // Update status
  const elapsed = ((Date.now() - generationStartTime) / 1000).toFixed(1);
  els.statusTokens.textContent = `${tokenCount} tokens`;
  els.statusTime.textContent = `${elapsed}s`;

  // Scroll to bottom
  const container = $('#codeContainer');
  container.scrollTop = container.scrollHeight;
});

window.api.onDone(({ requestId, eval_count }) => {
  if (requestId !== state.currentRequestId) return;

  setGenerating(false);
  els.codeCursor.classList.remove('active');

  // Final render with full highlighting
  renderCode(state.generatedCode);

  const elapsed = ((Date.now() - generationStartTime) / 1000).toFixed(1);
  const tps = tokenCount > 0 && elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : '?';
  els.statusTime.textContent = `${elapsed}s (${tps} t/s)`;

  showToast(`Generated ${tokenCount} tokens in ${elapsed}s`, 'success');
});

window.api.onError(({ requestId, error }) => {
  if (requestId !== state.currentRequestId) return;

  setGenerating(false);
  els.codeCursor.classList.remove('active');
  const isApiKeyError = /API key|Settings/i.test(error);
  if (isApiKeyError) {
    showToastWithAction(error, 'Open Settings', () => openSettingsModal());
  } else {
    showToast('Error: ' + error, 'error');
  }
});

// ─── Code Rendering ────────────────────────────────────────────────────
function renderCode(code) {
  if (!code) return;

  // Detect language for highlighting
  const lang = detectCodeLanguage(code);
  if (lang) {
    state.detectedLanguage = lang;
    els.codeLangBadge.textContent = lang.toUpperCase();

    // If auto-detect is on, update the dropdown hint
    if (state.currentLanguage === 'auto') {
      els.languageSelect.title = `Auto-detected: ${lang}`;
    }
  }

  // Syntax highlight
  let highlighted;
  try {
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
      if (hljs.highlightAuto(code).language) {
        state.detectedLanguage = hljs.highlightAuto(code).language;
        els.codeLangBadge.textContent = state.detectedLanguage.toUpperCase();
      }
    }
  } catch {
    highlighted = escapeHtml(code);
  }

  els.codeContent.innerHTML = highlighted;

  // Update line numbers
  const lineCount = code.split('\n').length;
  let lineNums = '';
  for (let i = 1; i <= lineCount; i++) {
    lineNums += i + '\n';
  }
  els.lineNumbers.textContent = lineNums;
}

function detectCodeLanguage(code) {
  // Quick heuristic detection from code content
  const firstLines = code.split('\n').slice(0, 10).join('\n').toLowerCase();

  if (firstLines.includes('import react') || firstLines.includes('from "react"') || firstLines.includes('jsx')) return 'javascript';
  if (firstLines.includes('#!/usr/bin/env python') || firstLines.includes('def ') || firstLines.includes('import ') && firstLines.includes(':')) return 'python';
  if (firstLines.includes('package main') || firstLines.includes('func main()')) return 'go';
  if (firstLines.includes('fn main()') || firstLines.includes('use std::')) return 'rust';
  if (firstLines.includes('#include') || firstLines.includes('int main(')) return 'cpp';
  if (firstLines.includes('public class') || firstLines.includes('public static void')) return 'java';
  if (firstLines.includes('using system') || firstLines.includes('namespace ')) return 'csharp';
  if (firstLines.includes('interface ') && firstLines.includes(': ')) return 'typescript';
  if (firstLines.includes('<!doctype') || firstLines.includes('<html')) return 'html';
  if (firstLines.includes('select ') && firstLines.includes(' from ')) return 'sql';
  if (firstLines.includes('#!/bin/bash') || firstLines.includes('#!/bin/sh')) return 'bash';
  if (firstLines.includes('const ') || firstLines.includes('function ') || firstLines.includes('=>')) return 'javascript';

  return state.currentLanguage !== 'auto' ? state.currentLanguage : null;
}

// ─── Prompt History UI ─────────────────────────────────────────────────
function addHistoryItem(prompt) {
  const div = document.createElement('div');
  div.className = 'history-item';
  div.textContent = prompt;
  div.title = prompt;
  div.addEventListener('click', () => {
    els.promptInput.value = prompt;
    els.promptInput.focus();
  });

  // Insert at top
  if (els.historyList.firstChild) {
    els.historyList.insertBefore(div, els.historyList.firstChild);
  } else {
    els.historyList.appendChild(div);
  }

  // Keep max 20 visible
  while (els.historyList.children.length > 20) {
    els.historyList.removeChild(els.historyList.lastChild);
  }
}

// ─── Toast Notifications ───────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
  els.toastContainer.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function showToastWithAction(message, actionLabel, onAction) {
  const toast = document.createElement('div');
  toast.className = 'toast error toast-with-action';

  const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  const btn = document.createElement('button');
  btn.className = 'toast-action-btn';
  btn.textContent = actionLabel;
  btn.type = 'button';
  btn.addEventListener('click', () => {
    onAction();
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  });

  toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  toast.appendChild(btn);
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 8000);
}

// ─── Utilities ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Settings Modal ────────────────────────────────────────────────────
function openSettingsModal() {
  const overlay = $('#settingsOverlay');
  const config = state.config;

  // Populate status badges
  updateKeyStatus('statusKeyOllamaCloud', config?.ollama_cloud?.has_key);
  updateKeyStatus('statusKeyOpenAI', config?.openai?.has_key);
  updateKeyStatus('statusKeyAnthropic', config?.anthropic?.has_key);

  // Clear inputs (we never send real keys to the renderer)
  $('#keyOllamaCloud').value = '';
  $('#keyOpenAI').value = '';
  $('#keyAnthropic').value = '';
  $('#keyOllamaCloud').placeholder = config?.ollama_cloud?.has_key ? '••••••••  (key is set)' : 'Enter Ollama Cloud API key...';
  $('#keyOpenAI').placeholder = config?.openai?.has_key ? '••••••••  (key is set)' : 'Enter OpenAI API key...';
  $('#keyAnthropic').placeholder = config?.anthropic?.has_key ? '••••••••  (key is set)' : 'Enter Anthropic API key...';

  overlay.style.display = 'flex';
  setTimeout(() => overlay.classList.add('open'), 10);
}

function closeSettingsModal() {
  const overlay = $('#settingsOverlay');
  overlay.classList.remove('open');
  setTimeout(() => { overlay.style.display = 'none'; }, 200);
}

function updateKeyStatus(id, hasKey) {
  const el = $(`#${id}`);
  if (!el) return;
  if (hasKey) {
    el.textContent = 'Configured';
    el.className = 'key-status key-set';
  } else {
    el.textContent = 'Not set';
    el.className = 'key-status key-missing';
  }
}

function setupSettingsModal() {
  const overlay = $('#settingsOverlay');
  if (!overlay) return;

  $('#btnCloseSettings').addEventListener('click', closeSettingsModal);
  $('#btnCancelSettings').addEventListener('click', closeSettingsModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettingsModal();
  });

  // Show/hide key toggles
  for (const btn of $$('.btn-toggle-vis')) {
    btn.addEventListener('click', () => {
      const input = $(`#${btn.dataset.target}`);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  // Save keys
  $('#btnSaveSettings').addEventListener('click', async () => {
    const keys = [
      { provider: 'ollama_cloud', value: $('#keyOllamaCloud').value.trim() },
      { provider: 'openai',       value: $('#keyOpenAI').value.trim() },
      { provider: 'anthropic',    value: $('#keyAnthropic').value.trim() },
    ];

    let saved = 0;
    for (const { provider, value } of keys) {
      if (!value) continue;
      const result = await window.api.setApiKey(provider, value);
      if (result.success) {
        saved++;
        if (!state.config[provider]) state.config[provider] = {};
        state.config[provider].has_key = true;
      }
    }

    if (saved > 0) {
      showToast(`Saved ${saved} API key${saved > 1 ? 's' : ''} successfully!`, 'success');
      state.config = await window.api.getConfig();
      checkConnection();
    } else {
      showToast('No new keys entered.', 'info');
    }

    closeSettingsModal();
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupSettingsModal();
});
