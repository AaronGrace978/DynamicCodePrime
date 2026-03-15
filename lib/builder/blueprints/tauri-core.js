const fs = require('fs');
const path = require('path');

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function ensureFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }
  return false;
}

function toProjectName(targetPath) {
  return path.basename(path.resolve(targetPath)).replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase() || 'dynamic-project';
}

function writeJsonIfMissing(filePath, value) {
  return ensureFile(filePath, JSON.stringify(value, null, 2));
}

function inferBuildStrategy(input) {
  const environment = input.environment || {};
  const workspace = input.workspace || {};
  const intent = String(input.intent || '').toLowerCase();

  const wantsPython = intent.includes('python') || intent.includes('pipeline') || workspace.detected?.manifests?.includes('python');
  const scenario = workspace.isEmpty || workspace.mode === 'blank' ? 'blank-foundation' : 'adopt-existing';
  const shouldScaffoldTauri = !workspace.detected?.hasTauri;
  const shouldExpandCore = !workspace.detected?.hasCore || workspace.mode === 'existing';
  const needsTauriGuidance = !environment.capabilities?.tauriReady;
  const stagePreview = [];

  stagePreview.push(scenario === 'blank-foundation' ? 'Lay down the base workspace' : 'Map and adopt the existing project');
  if (needsTauriGuidance) {
    stagePreview.push('Pause for Rust/Cargo/Tauri prerequisites');
  }
  stagePreview.push(shouldScaffoldTauri ? 'Scaffold a Tauri shell' : 'Reconcile the existing Tauri shell');
  if (shouldExpandCore) {
    stagePreview.push('Expand core architecture folders');
  }
  if (wantsPython) {
    stagePreview.push('Bootstrap Python pipeline support');
  }
  stagePreview.push('Generate a build map and validate the result');

  return {
    scenario,
    wantsPython,
    shouldScaffoldTauri,
    shouldExpandCore,
    needsTauriGuidance,
    summary: scenario === 'blank-foundation'
      ? 'Start with a clean foundation, then layer in Tauri, core modules, and optional Python pipelines.'
      : 'Adopt the current project structure, preserve what already exists, and fill in the missing layers incrementally.',
    headline: needsTauriGuidance
      ? 'This machine needs prerequisites before the full shell can be built.'
      : 'This machine is ready to build through the staged shell/core flow.',
    nextActions: [
      shouldScaffoldTauri ? 'Prepare the desktop shell first.' : 'Inspect and preserve the existing desktop shell.',
      shouldExpandCore ? 'Lay down core architecture lanes for future enhancements.' : 'Reuse the existing core folder and connect missing parts.',
      wantsPython ? 'Include Python pipeline support in the first pass.' : 'Keep Python optional unless requested later.',
    ],
    stagePreview,
  };
}

function createTauriCoreBlueprint(input) {
  const targetPath = input.targetPath;
  const projectName = toProjectName(targetPath);
  const strategy = inferBuildStrategy(input);
  const workspaceMode = input.workspace?.mode || 'blank';
  const stages = [];

  stages.push({
    id: 'strategy-manifest',
    title: 'Plan the staged build and write a build manifest',
    gate: 'approval',
    kind: 'analysis',
    async run(context) {
      const changes = [];
      const manifestPath = path.join(targetPath, 'core', 'shared', 'dynamic-code-prime.build.json');
      ensureDir(path.dirname(manifestPath));
      writeJsonIfMissing(manifestPath, {
        projectName,
        blueprint: 'tauri-core',
        targetPath,
        createdBy: 'DynamicCodePrime',
        scenario: strategy.scenario,
        stagePreview: strategy.stagePreview,
        environment: {
          platform: context.environment.platform,
          packageManagers: context.environment.packageManagers,
          capabilities: context.environment.capabilities,
        },
        workspace: context.workspace,
      });
      changes.push('Created a reusable build manifest for this staged session');
      return {
        summary: 'Build strategy prepared.',
        headline: strategy.headline,
        details: `${strategy.summary}\n\nUpcoming stages:\n- ${strategy.stagePreview.join('\n- ')}`,
        changes,
        artifacts: ['core/shared/dynamic-code-prime.build.json'],
        nextActions: strategy.nextActions,
        metadata: {
          graph: {
            nodes: [
              { path: 'core', label: 'core', type: 'directory' },
              { path: 'core/shared', label: 'shared', type: 'directory' },
              { path: 'core/shared/dynamic-code-prime.build.json', label: 'build manifest', type: 'config' },
            ],
            edges: [
              { from: '.', to: 'core', label: 'contains' },
              { from: 'core', to: 'core/shared', label: 'contains' },
              { from: 'core/shared', to: 'core/shared/dynamic-code-prime.build.json', label: 'records' },
            ],
          },
        },
        awaitApproval: true,
      };
    },
  });

  stages.push({
    id: 'prepare-workspace',
    title: workspaceMode === 'blank' ? 'Prepare blank workspace and baseline files' : 'Adopt existing workspace and normalize the baseline',
    gate: 'approval',
    kind: 'filesystem',
    async run(context) {
      const changes = [];
      ensureDir(targetPath);
      changes.push(`Ensured workspace exists: ${targetPath}`);

      const gitignorePath = path.join(targetPath, '.gitignore');
      if (ensureFile(gitignorePath, 'node_modules/\nsrc-tauri/target/\n.env\n')) {
        changes.push('Created .gitignore');
      }

      const pkgPath = path.join(targetPath, 'package.json');
      if (writeJsonIfMissing(pkgPath, {
        name: projectName,
        private: true,
        version: '0.1.0',
        scripts: {
          dev: 'echo "Add frontend dev script"',
          build: 'echo "Add frontend build script"',
        },
      })) {
        changes.push('Created package.json baseline');
      } else {
        changes.push('Preserved existing package.json');
      }

      return {
        summary: workspaceMode === 'blank' ? 'Workspace baseline prepared.' : 'Existing workspace adopted without destructive replacement.',
        details: workspaceMode === 'blank'
          ? 'Created the minimum files needed before scaffolding deeper layers.'
          : 'Preserved existing project files and only added missing baseline pieces.',
        changes,
        artifacts: ['package.json', '.gitignore'],
        nextActions: [
          'Review the baseline before the shell layer expands.',
          'Continue when ready to scaffold or reconcile the desktop shell.',
        ],
        metadata: {
          graph: {
            nodes: [
              { path: 'package.json', label: 'package.json', type: 'config' },
              { path: '.gitignore', label: '.gitignore', type: 'config' },
            ],
            edges: [
              { from: '.', to: 'package.json', label: 'contains' },
              { from: '.', to: '.gitignore', label: 'contains' },
            ],
          },
        },
        awaitApproval: true,
      };
    },
  });

  if (strategy.needsTauriGuidance) {
    stages.push({
      id: 'tauri-prerequisites-guidance',
      title: 'Check Rust and Tauri prerequisites',
      gate: 'approval',
      kind: 'guidance',
      async run(context) {
        const missing = [];
        if (!context.environment.tools.node?.installed) missing.push('Node.js');
        if (!context.environment.tools.npm?.installed) missing.push('npm');
        if (!context.environment.tools.rustc?.installed) missing.push('rustc');
        if (!context.environment.tools.cargo?.installed) missing.push('cargo');
        return {
          status: missing.length === 0 ? 'completed' : 'blocked',
          summary: missing.length === 0 ? 'Tauri prerequisites are now available.' : 'Install prerequisites before building the Tauri shell.',
          details: missing.length === 0
            ? 'The machine now has the runtime stack needed for the Tauri shell stage.'
            : `Missing prerequisites:\n- ${missing.join('\n- ')}\n\nInstall them, then click Retry Stage.`,
          changes: missing.length === 0 ? ['Environment re-check passed.'] : ['Build paused before shell scaffolding to avoid a blind failure.'],
          artifacts: [],
          nextActions: missing.length === 0 ? ['Retry or continue into shell scaffolding.'] : missing.map((item) => `Install ${item}`),
          awaitApproval: true,
        };
      },
    });
  }

  stages.push({
    id: 'scaffold-tauri-shell',
    title: strategy.shouldScaffoldTauri ? 'Scaffold Tauri shell' : 'Reconcile existing Tauri shell',
    gate: 'approval',
    kind: 'scaffold',
    async run(context, helpers) {
      const changes = [];
      const artifacts = [];
      const srcTauri = path.join(targetPath, 'src-tauri');
      ensureDir(srcTauri);
      ensureDir(path.join(srcTauri, 'src'));

      if (ensureFile(path.join(srcTauri, 'Cargo.toml'), `[package]
name = "${projectName}"
version = "0.1.0"
description = "DynamicCodePrime generated Tauri shell"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`)) {
        changes.push('Created src-tauri/Cargo.toml');
        artifacts.push('src-tauri/Cargo.toml');
      } else {
        changes.push('Preserved existing src-tauri/Cargo.toml');
      }

      if (ensureFile(path.join(srcTauri, 'build.rs'), 'fn main() {\n  tauri_build::build()\n}\n')) {
        changes.push('Created src-tauri/build.rs');
        artifacts.push('src-tauri/build.rs');
      } else {
        changes.push('Preserved existing src-tauri/build.rs');
      }

      if (ensureFile(path.join(srcTauri, 'src', 'main.rs'), `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
`)) {
        changes.push('Created src-tauri/src/main.rs');
        artifacts.push('src-tauri/src/main.rs');
      } else {
        changes.push('Preserved existing src-tauri/src/main.rs');
      }

      if (writeJsonIfMissing(path.join(srcTauri, 'tauri.conf.json'), {
        productName: 'DynamicCodePrimeApp',
        version: '0.1.0',
        identifier: 'com.dynamiccodeprime.app',
        build: {
          beforeDevCommand: 'npm run dev',
          beforeBuildCommand: 'npm run build',
          devUrl: 'http://localhost:1420',
          frontendDist: '../dist',
        },
        app: {
          windows: [{ title: 'DynamicCodePrime App', width: 1200, height: 800 }],
        },
        bundle: { active: true, targets: 'all' },
      })) {
        changes.push('Created src-tauri/tauri.conf.json');
        artifacts.push('src-tauri/tauri.conf.json');
      } else {
        changes.push('Preserved existing src-tauri/tauri.conf.json');
      }

      const canRunNpm = Boolean(context.environment.tools.node?.installed && context.environment.tools.npm?.installed);
      if (canRunNpm) {
        const npmInstall = await helpers.runProbe('npm install', []);
        if (npmInstall.ok) {
          changes.push('Ran npm install to normalize JavaScript dependencies');
        } else {
          changes.push('Attempted npm install, but it did not complete successfully');
        }
      } else {
        changes.push('Skipped npm install because Node/npm are unavailable');
      }

      return {
        status: context.environment.capabilities.tauriReady ? 'completed' : 'blocked',
        summary: strategy.shouldScaffoldTauri ? 'Tauri shell scaffolded.' : 'Existing Tauri shell reconciled and preserved.',
        details: context.environment.capabilities.tauriReady
          ? 'The Rust + Tauri base is ready for app-specific work.'
          : 'Install Rust/Cargo and ensure frontend build prerequisites are available, then retry this stage.',
        changes,
        artifacts,
        nextActions: [
          'Review the shell files before wiring app-specific capabilities.',
          'Continue into the core architecture stage.',
        ],
        metadata: {
          graph: {
            nodes: [
              { path: 'src-tauri', label: 'src-tauri', type: 'directory' },
              { path: 'src-tauri/src', label: 'src', type: 'directory' },
              { path: 'src-tauri/Cargo.toml', label: 'Cargo.toml', type: 'config' },
              { path: 'src-tauri/build.rs', label: 'build.rs', type: 'source' },
              { path: 'src-tauri/src/main.rs', label: 'main.rs', type: 'source' },
              { path: 'src-tauri/tauri.conf.json', label: 'tauri.conf.json', type: 'config' },
            ],
            edges: [
              { from: '.', to: 'src-tauri', label: 'contains' },
              { from: 'src-tauri', to: 'src-tauri/src', label: 'contains' },
              { from: 'src-tauri', to: 'src-tauri/Cargo.toml', label: 'configures' },
              { from: 'src-tauri', to: 'src-tauri/build.rs', label: 'builds' },
              { from: 'src-tauri/src', to: 'src-tauri/src/main.rs', label: 'boots' },
              { from: 'src-tauri', to: 'src-tauri/tauri.conf.json', label: 'configures' },
            ],
          },
        },
        awaitApproval: true,
      };
    },
  });

  if (strategy.shouldExpandCore) {
    stages.push({
      id: 'build-core-structure',
      title: input.workspace?.detected?.hasCore ? 'Expand core folder structure' : 'Build core folder structure',
      gate: 'approval',
      kind: 'architecture',
      async run() {
        const changes = [];
        const artifacts = [];
        const core = path.join(targetPath, 'core');
        const folders = [
          'agents',
          'pipelines',
          'shared',
          'docs',
          'logs',
        ];

        ensureDir(core);
        for (const folder of folders) {
          const folderPath = path.join(core, folder);
          ensureDir(folderPath);
          changes.push(`Ensured directory: core/${folder}`);
          artifacts.push(`core/${folder}`);
        }

        if (ensureFile(path.join(core, 'README.md'), `# core

This folder stores reusable runtime modules for DynamicCodePrime-generated projects.

- agents: orchestrators and autonomous routines
- pipelines: data and inference workflows
- shared: utility modules shared across project layers
- docs: project-specific technical docs
- logs: local run artifacts and traces
`)) {
          changes.push('Created core/README.md');
          artifacts.push('core/README.md');
        }

        return {
          summary: 'Core architecture lanes are ready.',
          details: 'This is the inner foundation for multi-stage expansion and project enhancements.',
          changes,
          artifacts,
          nextActions: [
            'Add pipeline support if needed.',
            'Continue into connection mapping and validation.',
          ],
          metadata: {
            graph: {
              nodes: [
                { path: 'core', label: 'core', type: 'directory' },
                { path: 'core/agents', label: 'agents', type: 'directory' },
                { path: 'core/pipelines', label: 'pipelines', type: 'directory' },
                { path: 'core/shared', label: 'shared', type: 'directory' },
                { path: 'core/docs', label: 'docs', type: 'directory' },
                { path: 'core/logs', label: 'logs', type: 'directory' },
                { path: 'core/README.md', label: 'core README', type: 'document' },
              ],
              edges: [
                { from: '.', to: 'core', label: 'contains' },
                { from: 'core', to: 'core/agents', label: 'contains' },
                { from: 'core', to: 'core/pipelines', label: 'contains' },
                { from: 'core', to: 'core/shared', label: 'contains' },
                { from: 'core', to: 'core/docs', label: 'contains' },
                { from: 'core', to: 'core/logs', label: 'contains' },
                { from: 'core', to: 'core/README.md', label: 'documents' },
              ],
            },
          },
          awaitApproval: true,
        };
      },
    });
  }

  if (strategy.wantsPython) {
    stages.push({
      id: 'python-pipeline-bootstrap',
      title: 'Bootstrap Python pipeline support',
      gate: 'approval',
      kind: 'pipeline',
      async run(context) {
        const changes = [];
        const artifacts = [];
        const pyReady = Boolean(context.environment.tools.python?.installed);
        const pipelineDir = path.join(targetPath, 'core', 'pipelines', 'python');
        ensureDir(pipelineDir);

        if (ensureFile(path.join(pipelineDir, 'requirements.txt'), 'requests>=2.31.0\n')) {
          changes.push('Created core/pipelines/python/requirements.txt');
          artifacts.push('core/pipelines/python/requirements.txt');
        }
        if (ensureFile(path.join(pipelineDir, 'pipeline_example.py'), `def run_pipeline(payload: dict) -> dict:
    \"\"\"Simple starter pipeline that can be extended by stage enhancements.\"\"\"
    return {"status": "ok", "input": payload}


if __name__ == "__main__":
    print(run_pipeline({"hello": "world"}))
`)) {
          changes.push('Created core/pipelines/python/pipeline_example.py');
          artifacts.push('core/pipelines/python/pipeline_example.py');
        }

        return {
          summary: pyReady ? 'Python pipeline scaffolded.' : 'Python pipeline layout created, but Python is still missing.',
          status: pyReady ? 'completed' : 'blocked',
          details: pyReady
            ? 'Detected Python and laid down a starter pipeline path.'
            : 'Python was not detected on this machine. Install Python, then retry this stage.',
          changes,
          artifacts,
          nextActions: pyReady ? ['Expand the starter pipeline during enhancement loops.'] : ['Install Python and retry this stage.'],
          metadata: {
            graph: {
              nodes: [
                { path: 'core/pipelines/python', label: 'python pipeline', type: 'directory' },
                { path: 'core/pipelines/python/requirements.txt', label: 'requirements.txt', type: 'config' },
                { path: 'core/pipelines/python/pipeline_example.py', label: 'pipeline example', type: 'source' },
              ],
              edges: [
                { from: 'core/pipelines', to: 'core/pipelines/python', label: 'contains' },
                { from: 'core/pipelines/python', to: 'core/pipelines/python/requirements.txt', label: 'depends_on' },
                { from: 'core/pipelines/python', to: 'core/pipelines/python/pipeline_example.py', label: 'executes' },
              ],
            },
          },
          awaitApproval: true,
        };
      },
    });
  }

  stages.push({
    id: 'connection-map',
    title: 'Generate project connection map',
    gate: 'approval',
    kind: 'documentation',
    async run(context) {
      const changes = [];
      const buildMapPath = path.join(targetPath, 'core', 'docs', 'build-map.md');
      ensureDir(path.dirname(buildMapPath));
      fs.writeFileSync(buildMapPath, `# Build Map

## Session

- Blueprint: Tauri + Core
- Target: ${targetPath}
- Scenario: ${strategy.scenario}

## Environment

- Platform: ${context.environment.platform}
- Shell: ${context.environment.shell}
- Package managers: ${(context.environment.packageManagers || []).join(', ') || 'none'}

## Workspace

- Mode: ${context.workspace.mode}
- Existing Tauri shell: ${context.workspace.detected?.hasTauri ? 'yes' : 'no'}
- Existing core folder: ${context.workspace.detected?.hasCore ? 'yes' : 'no'}

## Intent

${input.intent || 'No explicit intent provided.'}

## DynamicCodePrime strategy

${strategy.summary}

## Upcoming enhancements

- Add user-approved enhancements stage by stage
- Grow pipelines and agents without replacing preserved code
`, 'utf-8');
      changes.push('Generated a readable build map so the user can see how the project is being assembled');
      return {
        summary: 'Connection map generated.',
        details: 'This gives the project a human-readable memory of how the shell, core, and environment fit together.',
        changes,
        artifacts: ['core/docs/build-map.md'],
        nextActions: ['Use this map when deciding the next enhancement rooms to build.'],
        metadata: {
          graph: {
            nodes: [
              { path: 'core/docs/build-map.md', label: 'build map', type: 'document' },
            ],
            edges: [
              { from: 'core/docs', to: 'core/docs/build-map.md', label: 'documents' },
            ],
          },
        },
        awaitApproval: true,
      };
    },
  });

  stages.push({
    id: 'validation-and-report',
    title: 'Validate structure and report',
    gate: 'approval',
    kind: 'validation',
    async run(context) {
      const checks = [
        path.join(targetPath, 'package.json'),
        path.join(targetPath, 'src-tauri'),
        path.join(targetPath, 'core'),
        path.join(targetPath, 'core', 'docs', 'build-map.md'),
      ];
      if (strategy.wantsPython) {
        checks.push(path.join(targetPath, 'core', 'pipelines', 'python'));
      }
      const missing = checks.filter((checkPath) => !fs.existsSync(checkPath));
      const changes = checks.map((checkPath) => `${fs.existsSync(checkPath) ? 'OK' : 'MISSING'}: ${checkPath}`);

      return {
        summary: missing.length === 0
          ? 'Validation passed: the staged baseline is in place.'
          : `Validation found ${missing.length} missing item(s).`,
        status: missing.length === 0 ? 'completed' : 'blocked',
        details: missing.length === 0
          ? 'The project is ready for room-by-room enhancements.'
          : 'Resolve missing scaffold paths, then retry validation.',
        changes,
        artifacts: checks.map((checkPath) => path.relative(targetPath, checkPath) || '.'),
        nextActions: missing.length === 0
          ? ['Continue with enhancement loops for specific rooms of the project.']
          : ['Retry validation after resolving the missing paths.'],
        awaitApproval: true,
        metadata: {
          missing,
          environmentSnapshot: context.environment,
          workspaceSnapshot: context.workspace,
        },
      };
    },
  });

  return {
    id: 'tauri-core',
    label: 'Tauri + Core',
    strategy,
    stages,
  };
}

module.exports = {
  createTauriCoreBlueprint,
};
