const fs = require('fs');
const path = require('path');

function safeReadDir(targetPath) {
  try {
    return fs.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function detectLanguagesFromEntries(entries) {
  const languageSignals = new Set();
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (name.endsWith('.py')) languageSignals.add('python');
    if (name.endsWith('.rs')) languageSignals.add('rust');
    if (name.endsWith('.ts') || name.endsWith('.tsx')) languageSignals.add('typescript');
    if (name.endsWith('.js') || name.endsWith('.jsx')) languageSignals.add('javascript');
    if (name.endsWith('.go')) languageSignals.add('go');
    if (name.endsWith('.java')) languageSignals.add('java');
    if (name.endsWith('.cs')) languageSignals.add('csharp');
    if (name.endsWith('.cpp') || name.endsWith('.c')) languageSignals.add('cpp');
  }
  return Array.from(languageSignals);
}

function scanWorkspace(targetPath) {
  const exists = fs.existsSync(targetPath);
  if (!exists) {
    return {
      exists: false,
      isDirectory: false,
      isEmpty: true,
      mode: 'blank',
      entries: [],
      detected: {
        packageManagers: [],
        manifests: [],
        languages: [],
      },
    };
  }

  const stat = fs.statSync(targetPath);
  const isDirectory = stat.isDirectory();
  if (!isDirectory) {
    return {
      exists: true,
      isDirectory: false,
      isEmpty: false,
      mode: 'invalid_target',
      entries: [],
      detected: {
        packageManagers: [],
        manifests: [],
        languages: [],
      },
    };
  }

  const entries = safeReadDir(targetPath);
  const names = entries.map((entry) => entry.name);
  const lowerSet = new Set(names.map((name) => name.toLowerCase()));
  const manifests = [];
  const packageManagers = [];

  if (lowerSet.has('package.json')) manifests.push('package.json');
  if (lowerSet.has('cargo.toml')) manifests.push('Cargo.toml');
  if (lowerSet.has('requirements.txt') || lowerSet.has('pyproject.toml')) manifests.push('python');
  if (lowerSet.has('pnpm-lock.yaml')) packageManagers.push('pnpm');
  if (lowerSet.has('yarn.lock')) packageManagers.push('yarn');
  if (lowerSet.has('package-lock.json')) packageManagers.push('npm');
  if (lowerSet.has('.git')) manifests.push('.git');

  const isEmpty = entries.length === 0;
  let mode = 'existing';
  if (isEmpty) mode = 'blank';
  if (lowerSet.has('.git') && entries.length < 4) mode = 'mostly_blank';

  return {
    exists: true,
    isDirectory: true,
    isEmpty,
    mode,
    entries: names.slice(0, 100),
    detected: {
      packageManagers,
      manifests,
      languages: detectLanguagesFromEntries(entries),
      hasGit: lowerSet.has('.git'),
      hasTauri: lowerSet.has('src-tauri') || lowerSet.has('tauri.conf.json'),
      hasCore: lowerSet.has('core'),
    },
    scannedAt: new Date().toISOString(),
  };
}

module.exports = {
  scanWorkspace,
};
