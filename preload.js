/**
 * DynamicCodePrime - Preload Script
 * Secure bridge between main process and renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setApiKey: (provider, apiKey) => ipcRenderer.invoke('config:setApiKey', { provider, apiKey }),
  setProvider: (provider) => ipcRenderer.invoke('config:setProvider', provider),
  setModel: (model) => ipcRenderer.invoke('config:setModel', model),

  // AI Generation
  generate: (opts) => ipcRenderer.invoke('ai:generate', opts),
  checkConnection: () => ipcRenderer.invoke('ai:checkConnection'),
  listModels: () => ipcRenderer.invoke('ai:listModels'),

  // AI streaming events
  onToken: (callback) => ipcRenderer.on('ai:token', (_, data) => callback(data)),
  onDone: (callback) => ipcRenderer.on('ai:done', (_, data) => callback(data)),
  onStart: (callback) => ipcRenderer.on('ai:start', (_, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('ai:error', (_, data) => callback(data)),

  // Utilities
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  saveFile: (content, language) => ipcRenderer.invoke('file:save', { content, language }),
  pickFolder: () => ipcRenderer.invoke('file:pickFolder'),

  // Builder orchestration
  builderScanTarget: (targetPath) => ipcRenderer.invoke('builder:scanTarget', { targetPath }),
  builderCreateSession: (payload) => ipcRenderer.invoke('builder:createSession', payload),
  builderStart: (sessionId) => ipcRenderer.invoke('builder:start', { sessionId }),
  builderApproveStage: (sessionId) => ipcRenderer.invoke('builder:approveStage', { sessionId }),
  builderRequestEnhancement: (sessionId, enhancementPrompt) => ipcRenderer.invoke('builder:requestEnhancement', { sessionId, enhancementPrompt }),
  builderRetryStage: (sessionId) => ipcRenderer.invoke('builder:retryStage', { sessionId }),
  builderCancel: (sessionId) => ipcRenderer.invoke('builder:cancel', { sessionId }),
  builderGetSession: (sessionId) => ipcRenderer.invoke('builder:getSession', { sessionId }),
  builderListSessions: () => ipcRenderer.invoke('builder:listSessions'),
  onBuilderEvent: (callback) => ipcRenderer.on('builder:event', (_, data) => callback(data)),
});
