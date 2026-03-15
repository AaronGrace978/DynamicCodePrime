const { spawn } = require('child_process');

function runProbe(command, args = [], timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let done = false;

    const onDone = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      onDone({ ok: false, code: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim() });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      onDone({ ok: false, code: null, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      onDone({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function detectTool(name, versionCommand, parser) {
  const result = await runProbe(versionCommand, []);
  const raw = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return {
    name,
    installed: result.ok && !!raw,
    version: parser ? parser(raw) : raw.split('\n')[0] || '',
    raw,
  };
}

function firstLine(raw) {
  return String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean)[0] || '';
}

async function scanEnvironment() {
  const probes = await Promise.all([
    detectTool('node', 'node --version', firstLine),
    detectTool('npm', 'npm --version', firstLine),
    detectTool('pnpm', 'pnpm --version', firstLine),
    detectTool('yarn', 'yarn --version', firstLine),
    detectTool('python', 'python --version', firstLine),
    detectTool('pip', 'pip --version', firstLine),
    detectTool('uv', 'uv --version', firstLine),
    detectTool('rustc', 'rustc --version', firstLine),
    detectTool('cargo', 'cargo --version', firstLine),
    detectTool('tauri', 'tauri --version', firstLine),
    detectTool('git', 'git --version', firstLine),
  ]);

  const byName = Object.fromEntries(probes.map((probe) => [probe.name, probe]));
  const tauriReady = Boolean(byName.rustc?.installed && byName.cargo?.installed && byName.node?.installed && byName.npm?.installed);
  const packageManagers = ['npm', 'pnpm', 'yarn'].filter((name) => byName[name]?.installed);

  return {
    platform: process.platform,
    arch: process.arch,
    shell: process.env.SHELL || process.env.ComSpec || 'unknown',
    tools: byName,
    packageManagers,
    capabilities: {
      tauriReady,
      pythonReady: Boolean(byName.python?.installed),
      gitReady: Boolean(byName.git?.installed),
    },
    scannedAt: new Date().toISOString(),
  };
}

module.exports = {
  runProbe,
  scanEnvironment,
};
