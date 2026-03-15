const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { runStage } = require('./stage-runner');
const { runProbe, scanEnvironment } = require('./environment-scan');
const { scanWorkspace } = require('./workspace-scan');
const { createTauriCoreBlueprint } = require('./blueprints/tauri-core');
const { buildProjectGraph } = require('./graph-model');

class BuilderSessionManager {
  constructor(options = {}) {
    this.sessions = new Map();
    this.events = new EventEmitter();
    this.storagePath = options.storagePath || '';
    this.maxLogEntries = options.maxLogEntries || 400;
    this.maxHistoryEntries = options.maxHistoryEntries || 250;
    this.blueprints = {
      'tauri-core': createTauriCoreBlueprint,
    };
    this.loadPersistedSessions();
  }

  onEvent(handler) {
    this.events.on('builder-event', handler);
  }

  emit(type, payload) {
    this.events.emit('builder-event', { type, ...payload });
  }

  async scanTarget(targetPath) {
    const environment = await scanEnvironment();
    const workspace = scanWorkspace(targetPath);
    return { environment, workspace };
  }

  async createSession({ targetPath, intent = '', blueprintId = 'tauri-core', mode = 'both' }) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('targetPath is required to create a builder session.');
    }
    const resolvedTarget = path.resolve(targetPath);
    const environment = await scanEnvironment();
    const workspace = scanWorkspace(resolvedTarget);

    const blueprintFactory = this.blueprints[blueprintId];
    if (!blueprintFactory) {
      throw new Error(`Unknown blueprint: ${blueprintId}`);
    }
    const blueprint = blueprintFactory({ targetPath: resolvedTarget, intent, mode, environment, workspace });
    const stages = this.createRuntimeStages(blueprint.stages);

    const session = {
      id: crypto.randomUUID(),
      targetPath: resolvedTarget,
      intent,
      mode,
      blueprintId: blueprint.id,
      blueprintLabel: blueprint.label,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'ready',
      currentStageIndex: 0,
      waitingForInput: false,
      waitingStageId: null,
      isRunning: false,
      logs: [],
      history: [],
      timeline: [],
      graph: buildProjectGraph({ targetPath: resolvedTarget, stages: [] }),
      environment,
      workspace,
      strategy: blueprint.strategy || {},
      stages,
    };

    this.refreshSessionDerivedState(session);
    this.sessions.set(session.id, session);
    this.persistSessions();
    this.recordEvent(session, 'session-created', 'Session created and ready.', null);
    this.emit('status', { session: this.toPublicSession(session), message: 'Session created and ready.' });
    return this.toPublicSession(session);
  }

  listSessions() {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((session) => this.toPublicSession(session));
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? this.toPublicSession(session) : null;
  }

  async start(sessionId) {
    const session = this.requireSession(sessionId);
    if (session.waitingForInput) {
      throw new Error('Session is awaiting user input. Approve, retry, or enhance first.');
    }
    return this.runUntilPause(session);
  }

  async approveStage(sessionId) {
    const session = this.requireSession(sessionId);
    if (!session.waitingForInput) {
      throw new Error('No stage is waiting for approval.');
    }
    const approvedStageId = session.waitingStageId;
    session.waitingForInput = false;
    session.waitingStageId = null;
    session.currentStageIndex += 1;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    this.refreshSessionDerivedState(session);
    this.persistSessions();
    this.recordEvent(session, 'stage-approved', 'Stage approved. Continuing run.', approvedStageId);
    this.emit('status', { session: this.toPublicSession(session), message: 'Stage approved. Continuing run.' });
    return this.runUntilPause(session);
  }

  async requestEnhancement(sessionId, { enhancementPrompt = '' } = {}) {
    const session = this.requireSession(sessionId);
    if (!session.waitingForInput) {
      throw new Error('Enhancement requests are allowed only at approval checkpoints.');
    }
    const stage = session.stages[session.currentStageIndex];
    stage.requestedEnhancement = enhancementPrompt || 'Apply improvement pass for this stage.';
    stage.status = 'pending';
    stage.summary = '';
    stage.details = '';
    stage.changes = [];
    session.waitingForInput = false;
    session.waitingStageId = null;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    this.addLog(session, `Enhancement requested for stage "${stage.title}": ${stage.requestedEnhancement}`);
    this.refreshSessionDerivedState(session);
    this.persistSessions();
    this.recordEvent(session, 'stage-enhancement-requested', 'Enhancement requested, rerunning current stage.', stage.id);
    this.emit('status', { session: this.toPublicSession(session), message: 'Enhancement requested, rerunning current stage.' });
    return this.runUntilPause(session);
  }

  async retryStage(sessionId) {
    const session = this.requireSession(sessionId);
    if (!session.waitingForInput) {
      throw new Error('Retry is allowed only while awaiting approval.');
    }
    const stage = session.stages[session.currentStageIndex];
    stage.status = 'pending';
    stage.summary = '';
    stage.details = '';
    stage.changes = [];
    session.waitingForInput = false;
    session.waitingStageId = null;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    this.addLog(session, `Retry requested for stage "${stage.title}".`);
    this.refreshSessionDerivedState(session);
    this.persistSessions();
    this.recordEvent(session, 'stage-retry-requested', 'Retrying current stage.', stage.id);
    this.emit('status', { session: this.toPublicSession(session), message: 'Retrying current stage.' });
    return this.runUntilPause(session);
  }

  cancel(sessionId) {
    const session = this.requireSession(sessionId);
    session.status = 'cancelled';
    session.waitingForInput = false;
    session.waitingStageId = null;
    session.updatedAt = new Date().toISOString();
    this.addLog(session, 'Session cancelled by user.');
    this.refreshSessionDerivedState(session);
    this.persistSessions();
    this.recordEvent(session, 'session-cancelled', 'Session cancelled.', null);
    this.emit('status', { session: this.toPublicSession(session), message: 'Session cancelled.' });
    return this.toPublicSession(session);
  }

  async runUntilPause(session) {
    if (session.isRunning) {
      return this.toPublicSession(session);
    }
    session.isRunning = true;
    session.status = 'running';
    session.updatedAt = new Date().toISOString();
    this.refreshSessionDerivedState(session);
    this.persistSessions();

    try {
      while (session.currentStageIndex < session.stages.length) {
        const stage = session.stages[session.currentStageIndex];
        if (stage.status === 'completed') {
          session.currentStageIndex += 1;
          continue;
        }

        stage.status = 'running';
        stage.startedAt = new Date().toISOString();
        stage.finishedAt = null;
        stage.durationMs = null;
        stage.runCount += 1;
        session.environment = await scanEnvironment();
        session.workspace = scanWorkspace(session.targetPath);
        this.addLog(session, `Running stage ${session.currentStageIndex + 1}/${session.stages.length}: ${stage.title}`);
        this.refreshSessionDerivedState(session);
        this.recordEvent(session, 'stage-started', `Running stage: ${stage.title}`, stage.id);
        this.emit('stageStarted', { session: this.toPublicSession(session), stage: this.toPublicStage(stage) });

        const context = {
          sessionId: session.id,
          targetPath: session.targetPath,
          intent: session.intent,
          environment: session.environment,
          workspace: session.workspace,
          stage,
        };
        const helpers = {
          runProbe,
          log: (message) => this.addLog(session, message),
        };

        const result = await runStage(stage, context, helpers);
        stage.status = result.status;
        stage.summary = result.summary;
        stage.details = result.details;
        stage.changes = result.changes;
        stage.artifacts = result.artifacts || [];
        stage.nextActions = result.nextActions || [];
        stage.kind = result.kind || stage.kind || 'task';
        stage.headline = result.headline || '';
        stage.metadata = result.metadata || {};
        stage.finishedAt = new Date().toISOString();
        stage.durationMs = stage.startedAt ? new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime() : null;
        session.updatedAt = new Date().toISOString();
        this.refreshSessionDerivedState(session);
        this.persistSessions();
        this.recordEvent(session, 'stage-completed', stage.summary || `${stage.title} completed.`, stage.id);
        this.emit('stageCompleted', { session: this.toPublicSession(session), stage: this.toPublicStage(stage) });

        if (result.status === 'failed' || result.status === 'blocked') {
          session.status = result.status;
          session.waitingForInput = true;
          session.waitingStageId = stage.id;
          this.addLog(session, `Stage blocked/failure: ${stage.summary}`);
          this.refreshSessionDerivedState(session);
          this.recordEvent(session, 'stage-blocked', stage.summary, stage.id);
          this.emit('needsInput', {
            session: this.toPublicSession(session),
            stage: this.toPublicStage(stage),
            message: 'Stage requires user action (retry/enhance/stop).',
          });
          this.persistSessions();
          return this.toPublicSession(session);
        }

        if (stage.gate === 'approval' || result.awaitApproval) {
          session.status = 'awaiting_approval';
          session.waitingForInput = true;
          session.waitingStageId = stage.id;
          this.addLog(session, `Waiting for approval after stage: ${stage.title}`);
          this.refreshSessionDerivedState(session);
          this.recordEvent(session, 'stage-awaiting-approval', `Awaiting approval after ${stage.title}.`, stage.id);
          this.emit('needsInput', {
            session: this.toPublicSession(session),
            stage: this.toPublicStage(stage),
            message: 'Stage complete. Approve to continue or request enhancement.',
          });
          this.persistSessions();
          return this.toPublicSession(session);
        }

        session.currentStageIndex += 1;
        this.refreshSessionDerivedState(session);
        this.persistSessions();
      }

      session.status = 'completed';
      session.updatedAt = new Date().toISOString();
      this.addLog(session, 'All stages completed.');
      this.refreshSessionDerivedState(session);
      this.persistSessions();
      this.recordEvent(session, 'session-completed', 'Builder session completed.', null);
      this.emit('status', { session: this.toPublicSession(session), message: 'Builder session completed.' });
      return this.toPublicSession(session);
    } finally {
      session.isRunning = false;
      this.refreshSessionDerivedState(session);
      this.persistSessions();
    }
  }

  addLog(session, message) {
    session.logs.push({
      at: new Date().toISOString(),
      message,
    });
    if (session.logs.length > this.maxLogEntries) {
      session.logs.splice(0, session.logs.length - this.maxLogEntries);
    }
    this.persistSessions();
    this.emit('log', { sessionId: session.id, entry: session.logs[session.logs.length - 1] });
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown builder session: ${sessionId}`);
    }
    return session;
  }

  toPublicSession(session) {
    return {
      id: session.id,
      targetPath: session.targetPath,
      intent: session.intent,
      mode: session.mode,
      blueprintId: session.blueprintId,
      blueprintLabel: session.blueprintLabel,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      currentStageIndex: session.currentStageIndex,
      waitingForInput: session.waitingForInput,
      waitingStageId: session.waitingStageId,
      logs: session.logs,
      history: session.history,
      timeline: session.timeline,
      graph: session.graph,
      environment: session.environment,
      workspace: session.workspace,
      strategy: session.strategy,
      stages: session.stages.map((stage) => this.toPublicStage(stage)),
    };
  }

  toPublicStage(stage) {
    return {
      id: stage.id,
      title: stage.title,
      gate: stage.gate,
      kind: stage.kind,
      headline: stage.headline,
      index: stage.index,
      status: stage.status,
      summary: stage.summary,
      details: stage.details,
      changes: stage.changes,
      artifacts: stage.artifacts,
      nextActions: stage.nextActions,
      metadata: stage.metadata,
      runCount: stage.runCount,
      startedAt: stage.startedAt,
      finishedAt: stage.finishedAt,
      durationMs: stage.durationMs,
      requestedEnhancement: stage.requestedEnhancement,
    };
  }

  createRuntimeStages(stages, persistedStages = []) {
    return stages.map((stage, index) => {
      const saved = persistedStages.find((candidate) => candidate.id === stage.id) || {};
      return {
        ...stage,
        index,
        status: saved.status || 'pending',
        summary: saved.summary || '',
        details: saved.details || '',
        changes: Array.isArray(saved.changes) ? saved.changes : [],
        artifacts: Array.isArray(saved.artifacts) ? saved.artifacts : [],
        nextActions: Array.isArray(saved.nextActions) ? saved.nextActions : [],
        metadata: saved.metadata || {},
        requestedEnhancement: saved.requestedEnhancement || '',
        runCount: saved.runCount || 0,
        startedAt: saved.startedAt || null,
        finishedAt: saved.finishedAt || null,
        durationMs: saved.durationMs || null,
        kind: saved.kind || stage.kind || 'task',
        headline: saved.headline || '',
      };
    });
  }

  loadPersistedSessions() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const data = JSON.parse(raw);
      const snapshots = Array.isArray(data?.sessions) ? data.sessions : [];
      for (const snapshot of snapshots) {
        const restored = this.restoreSession(snapshot);
        if (restored) {
          this.sessions.set(restored.id, restored);
        }
      }
    } catch {
      // Ignore restore issues and start with a clean in-memory session map.
    }
  }

  restoreSession(snapshot) {
    const blueprintFactory = this.blueprints[snapshot.blueprintId];
    if (!blueprintFactory) return null;
    const blueprint = blueprintFactory({
      targetPath: snapshot.targetPath,
      intent: snapshot.intent || '',
      mode: snapshot.mode || 'both',
      environment: snapshot.environment,
      workspace: snapshot.workspace,
    });
    const restored = {
      id: snapshot.id,
      targetPath: snapshot.targetPath,
      intent: snapshot.intent || '',
      mode: snapshot.mode || 'both',
      blueprintId: snapshot.blueprintId,
      blueprintLabel: blueprint.label,
      createdAt: snapshot.createdAt || new Date().toISOString(),
      updatedAt: snapshot.updatedAt || new Date().toISOString(),
      status: snapshot.status || 'ready',
      currentStageIndex: snapshot.currentStageIndex || 0,
      waitingForInput: Boolean(snapshot.waitingForInput),
      waitingStageId: snapshot.waitingStageId || null,
      isRunning: false,
      logs: Array.isArray(snapshot.logs) ? snapshot.logs : [],
      history: Array.isArray(snapshot.history) ? snapshot.history : [],
      timeline: Array.isArray(snapshot.timeline) ? snapshot.timeline : [],
      graph: snapshot.graph || buildProjectGraph({ targetPath: snapshot.targetPath, stages: snapshot.stages || [] }),
      environment: snapshot.environment || null,
      workspace: snapshot.workspace || null,
      strategy: snapshot.strategy || blueprint.strategy || {},
      stages: this.createRuntimeStages(blueprint.stages, snapshot.stages || []),
    };
    this.refreshSessionDerivedState(restored);
    return restored;
  }

  persistSessions() {
    if (!this.storagePath) return;
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const payload = {
        version: 1,
        sessions: Array.from(this.sessions.values()).map((session) => this.toPublicSession(session)),
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Persistence should not break the live builder.
    }
  }

  refreshSessionDerivedState(session) {
    session.timeline = (session.stages || []).map((stage) => ({
      stageId: stage.id,
      title: stage.title,
      order: stage.index,
      status: stage.status,
      startedAt: stage.startedAt,
      finishedAt: stage.finishedAt,
      durationMs: stage.durationMs || null,
      headline: stage.headline || '',
    }));
    session.graph = buildProjectGraph(session);
  }

  recordEvent(session, type, message, stageId) {
    const entry = {
      id: crypto.randomUUID(),
      type,
      at: new Date().toISOString(),
      message,
      stageId: stageId || null,
      snapshot: this.makeHistorySnapshot(session),
    };
    session.history = Array.isArray(session.history) ? session.history : [];
    session.history.push(entry);
    if (session.history.length > this.maxHistoryEntries) {
      session.history.splice(0, session.history.length - this.maxHistoryEntries);
    }
    this.persistSessions();
    this.emit('history', { sessionId: session.id, entry });
  }

  makeHistorySnapshot(session) {
    return {
      sessionStatus: session.status,
      currentStageIndex: session.currentStageIndex,
      waitingStageId: session.waitingStageId,
      graph: session.graph,
      timeline: session.timeline,
      stages: (session.stages || []).map((stage) => ({
        id: stage.id,
        title: stage.title,
        status: stage.status,
        summary: stage.summary,
        headline: stage.headline,
        artifacts: stage.artifacts,
        nextActions: stage.nextActions,
        startedAt: stage.startedAt,
        finishedAt: stage.finishedAt,
        durationMs: stage.durationMs || null,
      })),
    };
  }
}

module.exports = {
  BuilderSessionManager,
};
