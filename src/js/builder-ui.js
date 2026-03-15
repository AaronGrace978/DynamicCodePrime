/**
 * DynamicCodePrime - Staged Builder UI
 * Human-in-the-loop orchestration dashboard.
 */

(function initBuilderUI() {
  const $ = (sel) => document.querySelector(sel);
  const visuals = window.BuilderVisuals || {};

  const els = {
    tabBuilder: $('#tabBuilder'),
    tabCodeTool: $('#tabCodeTool'),
    builderApp: $('#builderApp'),
    codeApp: $('#app'),
    builderResumeSession: $('#builderResumeSession'),
    builderLoadSession: $('#builderLoadSession'),
    builderTargetPath: $('#builderTargetPath'),
    builderPickFolder: $('#builderPickFolder'),
    builderIntent: $('#builderIntent'),
    builderMode: $('#builderMode'),
    builderScan: $('#builderScan'),
    builderCreateSession: $('#builderCreateSession'),
    builderStart: $('#builderStart'),
    builderApprove: $('#builderApprove'),
    builderRetry: $('#builderRetry'),
    builderCancel: $('#builderCancel'),
    builderEnhancement: $('#builderEnhancement'),
    builderEnhance: $('#builderEnhance'),
    builderEnvironmentSummary: $('#builderEnvironmentSummary'),
    builderWorkspaceSummary: $('#builderWorkspaceSummary'),
    builderStrategySummary: $('#builderStrategySummary'),
    builderArtifactSummary: $('#builderArtifactSummary'),
    builderNextActionSummary: $('#builderNextActionSummary'),
    builderGraphNodeSummary: $('#builderGraphNodeSummary'),
    builderProgressBar: $('#builderProgressBar'),
    builderStageList: $('#builderStageList'),
    builderCurrentStageSummary: $('#builderCurrentStageSummary'),
    builderLiveLog: $('#builderLiveLog'),
    builderSessionMeta: $('#builderSessionMeta'),
    builderGraphCanvas: $('#builderGraphCanvas'),
    builderReplayPrev: $('#builderReplayPrev'),
    builderReplayPlay: $('#builderReplayPlay'),
    builderReplayNext: $('#builderReplayNext'),
    builderReplayRange: $('#builderReplayRange'),
    builderReplayLabel: $('#builderReplayLabel'),
  };

  if (!els.builderApp) return;

  const state = {
    sessionId: null,
    session: null,
    lastScan: null,
    selectedStageId: null,
    selectedGraphNodeId: null,
    replayIndex: null,
    replayTimer: null,
  };

  function setWorkspaceTab(mode) {
    const isBuilder = mode === 'builder';
    els.tabBuilder.classList.toggle('active', isBuilder);
    els.tabCodeTool.classList.toggle('active', !isBuilder);
    els.builderApp.style.display = isBuilder ? 'grid' : 'none';
    els.codeApp.style.display = isBuilder ? 'none' : 'flex';
  }

  function toOneLine(input) {
    return String(input || '').replace(/\s+/g, ' ').trim();
  }

  function formatDuration(durationMs) {
    return visuals.formatDuration ? visuals.formatDuration(durationMs) : `${durationMs || 0}ms`;
  }

  function summarizeEnvironment(environment) {
    if (!environment) return 'No environment snapshot.';
    const tools = environment.tools || {};
    const lines = [
      `Platform: ${environment.platform} (${environment.arch})`,
      `Shell: ${environment.shell || 'unknown'}`,
      `Node: ${tools.node?.installed ? tools.node.version : 'missing'}`,
      `npm: ${tools.npm?.installed ? tools.npm.version : 'missing'}`,
      `Rust: ${tools.rustc?.installed ? tools.rustc.version : 'missing'}`,
      `Cargo: ${tools.cargo?.installed ? tools.cargo.version : 'missing'}`,
      `Python: ${tools.python?.installed ? tools.python.version : 'missing'}`,
      `pip: ${tools.pip?.installed ? tools.pip.version : 'missing'}`,
      `Git: ${tools.git?.installed ? tools.git.version : 'missing'}`,
      `Tauri-ready: ${environment.capabilities?.tauriReady ? 'yes' : 'no'}`,
    ];
    return lines.join('\n');
  }

  function summarizeWorkspace(workspace) {
    if (!workspace) return 'No workspace snapshot.';
    const lines = [
      `Exists: ${workspace.exists ? 'yes' : 'no'}`,
      `Directory: ${workspace.isDirectory ? 'yes' : 'no'}`,
      `Empty: ${workspace.isEmpty ? 'yes' : 'no'}`,
      `Mode: ${workspace.mode || 'unknown'}`,
      `Has git: ${workspace.detected?.hasGit ? 'yes' : 'no'}`,
      `Has Tauri: ${workspace.detected?.hasTauri ? 'yes' : 'no'}`,
      `Has core: ${workspace.detected?.hasCore ? 'yes' : 'no'}`,
      `Package managers: ${(workspace.detected?.packageManagers || []).join(', ') || 'none detected'}`,
      `Manifests: ${(workspace.detected?.manifests || []).join(', ') || 'none detected'}`,
      `Languages: ${(workspace.detected?.languages || []).join(', ') || 'none detected'}`,
    ];
    return lines.join('\n');
  }

  function getHistory(session) {
    return Array.isArray(session?.history) ? session.history : [];
  }

  function clampReplayIndex(session) {
    const history = getHistory(session);
    if (history.length === 0) {
      state.replayIndex = null;
      return null;
    }
    if (state.replayIndex == null) {
      state.replayIndex = history.length - 1;
    }
    state.replayIndex = Math.max(0, Math.min(history.length - 1, state.replayIndex));
    return state.replayIndex;
  }

  function getReplayFrame(session) {
    const history = getHistory(session);
    const index = clampReplayIndex(session);
    if (index == null) return null;
    return history[index] || null;
  }

  function buildSessionView(session) {
    const frame = getReplayFrame(session);
    if (!frame?.snapshot) {
      return { ...session, replayFrame: null };
    }

    const snapshotStages = frame.snapshot.stages || [];
    const stages = (session.stages || []).map((stage) => {
      const snap = snapshotStages.find((candidate) => candidate.id === stage.id);
      return snap ? { ...stage, ...snap } : stage;
    });

    return {
      ...session,
      status: frame.snapshot.sessionStatus || session.status,
      currentStageIndex: frame.snapshot.currentStageIndex ?? session.currentStageIndex,
      waitingStageId: frame.snapshot.waitingStageId ?? session.waitingStageId,
      timeline: frame.snapshot.timeline || session.timeline || [],
      graph: frame.snapshot.graph || session.graph || null,
      stages,
      replayFrame: frame,
    };
  }

  function getSelectedStage(sessionView) {
    return (sessionView.stages || []).find((stage) => stage.id === state.selectedStageId)
      || (sessionView.stages || [])[sessionView.currentStageIndex]
      || (sessionView.stages || [])[0]
      || null;
  }

  function renderStageList(sessionView) {
    els.builderStageList.innerHTML = '';
    for (const stage of sessionView.stages || []) {
      const durationText = stage.durationMs ? ` · ${formatDuration(stage.durationMs)}` : '';
      const item = document.createElement('div');
      item.className = `builder-stage ${stage.status || 'pending'}`;
      if (state.selectedStageId === stage.id || (!state.selectedStageId && stage.index === sessionView.currentStageIndex)) {
        item.classList.add('selected');
      }
      item.innerHTML = `
        <div class="builder-stage-title">${stage.index + 1}. ${stage.title}</div>
        <div class="builder-stage-status">${stage.status}${durationText}</div>
        <div class="builder-stage-summary">${stage.summary || 'Waiting to run...'}</div>
      `;
      item.addEventListener('click', () => {
        state.selectedStageId = stage.id;
        renderStageDetails(stage);
        renderStageList(sessionView);
      });
      els.builderStageList.appendChild(item);
    }
  }

  function renderStageDetails(stage) {
    if (!stage) {
      els.builderCurrentStageSummary.textContent = 'No stage selected yet.';
      els.builderArtifactSummary.textContent = 'No artifacts yet.';
      els.builderNextActionSummary.textContent = 'No suggestions yet.';
      return;
    }

    const details = [
      `Stage: ${stage.title}`,
      `Kind: ${stage.kind || 'task'}`,
      `Status: ${stage.status}`,
      `Run count: ${stage.runCount || 0}`,
      `Duration: ${formatDuration(stage.durationMs)}`,
      stage.headline ? `Headline: ${stage.headline}` : '',
      '',
      stage.details || '',
      '',
      'Changes:',
      ...(stage.changes || []).map((change) => `- ${toOneLine(change)}`),
    ].filter(Boolean).join('\n');

    els.builderCurrentStageSummary.textContent = details.trim() || 'No stage details yet.';
    els.builderArtifactSummary.textContent = (stage.artifacts && stage.artifacts.length > 0)
      ? stage.artifacts.map((artifact) => `- ${artifact}`).join('\n')
      : 'No artifacts yet.';
    els.builderNextActionSummary.textContent = (stage.nextActions && stage.nextActions.length > 0)
      ? stage.nextActions.map((action) => `- ${action}`).join('\n')
      : 'No suggestions yet.';
  }

  function renderConsole(session) {
    const history = getHistory(session);
    const source = history.length > 0
      ? history.slice(-160).map((entry) => `[${entry.at}] [${entry.type}] ${entry.message}`)
      : (session.logs || []).slice(-120).map((entry) => `[${entry.at}] ${entry.message}`);
    els.builderLiveLog.textContent = source.length > 0 ? source.join('\n') : 'No console events yet.';
    els.builderLiveLog.scrollTop = els.builderLiveLog.scrollHeight;
  }

  function renderReplayControls(sessionView) {
    const history = getHistory(state.session);
    if (history.length === 0) {
      els.builderReplayRange.max = '0';
      els.builderReplayRange.value = '0';
      els.builderReplayLabel.textContent = 'Replay idle.';
      els.builderReplayPlay.textContent = 'Play';
      return;
    }

    const index = clampReplayIndex(state.session);
    els.builderReplayRange.max = String(history.length - 1);
    els.builderReplayRange.value = String(index);
    const frame = history[index];
    const latest = index === history.length - 1;
    els.builderReplayLabel.textContent = `${latest ? 'Live' : 'Replay'} frame ${index + 1}/${history.length} · ${frame.type} · ${frame.message}`;
    els.builderReplayPlay.textContent = state.replayTimer ? 'Pause' : 'Play';
  }

  function renderGraph(sessionView) {
    if (sessionView.graph?.nodes?.length > 0 && !state.selectedGraphNodeId) {
      state.selectedGraphNodeId = sessionView.graph.nodes[0].id;
    }
    if (visuals.renderProjectGraph) {
      visuals.renderProjectGraph(
        els.builderGraphCanvas,
        sessionView.graph,
        state.selectedGraphNodeId,
        (nodeId) => {
          state.selectedGraphNodeId = nodeId;
          renderGraph(sessionView);
          renderGraphNodeDetails(sessionView);
        }
      );
    }
    renderGraphNodeDetails(sessionView);
  }

  function renderGraphNodeDetails(sessionView) {
    const graph = sessionView.graph;
    const node = graph?.nodes?.find((entry) => entry.id === state.selectedGraphNodeId)
      || graph?.nodes?.[0];
    if (!node) {
      els.builderGraphNodeSummary.textContent = 'Select a graph node to inspect it.';
      return;
    }

    const createdStages = (node.createdByStageIds || []).map((stageId) => {
      const stage = (sessionView.stages || []).find((candidate) => candidate.id === stageId);
      return stage ? `${stage.title} (${stageId})` : stageId;
    });

    els.builderGraphNodeSummary.textContent = [
      `Label: ${node.label}`,
      `Path: ${node.path}`,
      `Type: ${node.type}`,
      `Depth: ${node.depth}`,
      '',
      'Created by stages:',
      ...(createdStages.length > 0 ? createdStages.map((value) => `- ${value}`) : ['- Unknown or inferred']),
      '',
      'Touched by stages:',
      ...((node.touchedByStageIds || []).length > 0
        ? node.touchedByStageIds.map((value) => `- ${value}`)
        : ['- None recorded']),
    ].join('\n');
  }

  function renderSession(session) {
    if (!session) return;
    state.session = session;
    state.sessionId = session.id;

    const sessionView = buildSessionView(session);
    const completedCount = (sessionView.stages || []).filter((stage) => stage.status === 'completed').length;
    const totalStages = (sessionView.stages || []).length || 1;
    const progressPct = Math.max(6, Math.round((completedCount / totalStages) * 100));

    els.builderSessionMeta.textContent = `Session ${session.id.slice(0, 8)} · ${session.blueprintLabel} · status: ${sessionView.status}`;
    els.builderProgressBar.style.width = `${progressPct}%`;
    els.builderStrategySummary.textContent = [
      session.strategy?.headline || 'No strategy headline yet.',
      '',
      session.strategy?.summary || 'No strategy summary yet.',
      '',
      'Planned flow:',
      ...((session.strategy?.stagePreview || []).map((step) => `- ${step}`)),
    ].join('\n').trim();

    if (session.environment) {
      els.builderEnvironmentSummary.textContent = summarizeEnvironment(session.environment);
    }
    if (session.workspace) {
      els.builderWorkspaceSummary.textContent = summarizeWorkspace(session.workspace);
    }

    renderReplayControls(sessionView);
    renderStageList(sessionView);
    renderConsole(session);
    renderStageDetails(getSelectedStage(sessionView));
    renderGraph(sessionView);
    refreshSessionPicker(session.id).catch(() => {});
  }

  function checkResult(result) {
    if (!result?.success) {
      throw new Error(result?.error || 'Unknown error');
    }
    return result;
  }

  async function scanTarget() {
    const targetPath = els.builderTargetPath.value.trim();
    if (!targetPath) {
      els.builderWorkspaceSummary.textContent = 'Enter a target path before scanning.';
      return;
    }
    const result = checkResult(await window.api.builderScanTarget(targetPath));
    state.lastScan = result;
    els.builderEnvironmentSummary.textContent = summarizeEnvironment(result.environment);
    els.builderWorkspaceSummary.textContent = summarizeWorkspace(result.workspace);
  }

  async function createSession() {
    const targetPath = els.builderTargetPath.value.trim();
    if (!targetPath) {
      els.builderWorkspaceSummary.textContent = 'Enter a target path first.';
      return;
    }
    const result = checkResult(await window.api.builderCreateSession({
      targetPath,
      intent: els.builderIntent.value.trim(),
      mode: els.builderMode.value,
      blueprintId: 'tauri-core',
    }));
    state.selectedStageId = null;
    state.selectedGraphNodeId = null;
    state.replayIndex = null;
    renderSession(result.session);
  }

  async function startSession() {
    if (!state.sessionId) return;
    els.builderStart.classList.add('loading');
    try {
      const result = checkResult(await window.api.builderStart(state.sessionId));
      state.replayIndex = null;
      renderSession(result.session);
    } finally {
      els.builderStart.classList.remove('loading');
    }
  }

  async function approveStage() {
    if (!state.sessionId) return;
    const result = checkResult(await window.api.builderApproveStage(state.sessionId));
    state.replayIndex = null;
    renderSession(result.session);
  }

  async function retryStage() {
    if (!state.sessionId) return;
    const result = checkResult(await window.api.builderRetryStage(state.sessionId));
    state.replayIndex = null;
    renderSession(result.session);
  }

  async function cancelSession() {
    if (!state.sessionId) return;
    const result = checkResult(await window.api.builderCancel(state.sessionId));
    state.replayIndex = null;
    renderSession(result.session);
  }

  async function enhanceStage() {
    if (!state.sessionId) return;
    const enhancementPrompt = els.builderEnhancement.value.trim();
    const result = checkResult(await window.api.builderRequestEnhancement(state.sessionId, enhancementPrompt));
    els.builderEnhancement.value = '';
    state.replayIndex = null;
    renderSession(result.session);
  }

  function stopReplayTimer() {
    if (state.replayTimer) {
      clearInterval(state.replayTimer);
      state.replayTimer = null;
    }
  }

  function shiftReplay(delta) {
    if (!state.session) return;
    const history = getHistory(state.session);
    if (history.length === 0) return;
    clampReplayIndex(state.session);
    state.replayIndex = Math.max(0, Math.min(history.length - 1, (state.replayIndex || 0) + delta));
    renderSession(state.session);
  }

  function toggleReplay() {
    if (!state.session) return;
    const history = getHistory(state.session);
    if (history.length === 0) return;

    if (state.replayTimer) {
      stopReplayTimer();
      renderSession(state.session);
      return;
    }

    clampReplayIndex(state.session);
    if (state.replayIndex == null || state.replayIndex >= history.length - 1) {
      state.replayIndex = 0;
    }
    state.replayTimer = setInterval(() => {
      if (!state.session) {
        stopReplayTimer();
        return;
      }
      const maxIndex = getHistory(state.session).length - 1;
      if (state.replayIndex >= maxIndex) {
        stopReplayTimer();
      } else {
        state.replayIndex += 1;
      }
      renderSession(state.session);
    }, 900);
    renderSession(state.session);
  }

  function onBuilderEvent(event) {
    if (!event) return;
    if (event.session) {
      renderSession(event.session);
      return;
    }

    if (event.sessionId && state.session && event.sessionId === state.session.id && event.entry) {
      if (event.type === 'log') {
        const merged = {
          ...state.session,
          logs: [...(state.session.logs || []), event.entry],
        };
        renderSession(merged);
        return;
      }
      if (event.type === 'history') {
        const merged = {
          ...state.session,
          history: [...(state.session.history || []), event.entry],
        };
        renderSession(merged);
      }
    }
  }

  async function refreshSessionPicker(selectedId = state.sessionId) {
    const result = await window.api.builderListSessions();
    if (!result?.success) return;
    const sessions = Array.isArray(result.sessions) ? result.sessions : [];
    els.builderResumeSession.innerHTML = '';
    if (sessions.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No saved sessions';
      els.builderResumeSession.appendChild(empty);
      return;
    }
    for (const session of sessions) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = `${session.id.slice(0, 8)} · ${session.status} · ${session.targetPath}`;
      if (session.id === selectedId) option.selected = true;
      els.builderResumeSession.appendChild(option);
    }
  }

  async function loadSelectedSession() {
    const sessionId = els.builderResumeSession.value;
    if (!sessionId) return;
    const result = checkResult(await window.api.builderGetSession(sessionId));
    if (result.session) {
      els.builderTargetPath.value = result.session.targetPath || '';
      els.builderIntent.value = result.session.intent || '';
      els.builderMode.value = result.session.mode || 'both';
      state.selectedStageId = null;
      state.selectedGraphNodeId = null;
      state.replayIndex = null;
      renderSession(result.session);
    }
  }

  async function bootstrapDefaultPath() {
    const existingPath = els.builderTargetPath.value.trim();
    if (existingPath) {
      refreshSessionPicker().catch(() => {});
      return;
    }
    try {
      const sessionsResult = await window.api.builderListSessions();
      if (sessionsResult?.success && Array.isArray(sessionsResult.sessions) && sessionsResult.sessions[0]?.targetPath) {
        const latest = sessionsResult.sessions[0];
        els.builderTargetPath.value = latest.targetPath;
        els.builderIntent.value = latest.intent || '';
        els.builderMode.value = latest.mode || 'both';
        renderSession(latest);
        await refreshSessionPicker(latest.id);
        return;
      }
    } catch {
      // noop
    }
    els.builderTargetPath.value = 'G:\\';
    refreshSessionPicker().catch(() => {});
  }

  els.tabBuilder.addEventListener('click', () => setWorkspaceTab('builder'));
  els.tabCodeTool.addEventListener('click', () => setWorkspaceTab('code'));
  els.builderPickFolder.addEventListener('click', async () => {
    const picked = await window.api.pickFolder();
    if (picked?.selected) {
      els.builderTargetPath.value = picked.path;
    }
  });
  els.builderLoadSession.addEventListener('click', () => loadSelectedSession().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderScan.addEventListener('click', () => scanTarget().catch((e) => { els.builderWorkspaceSummary.textContent = e.message; }));
  els.builderCreateSession.addEventListener('click', () => createSession().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderStart.addEventListener('click', () => startSession().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderApprove.addEventListener('click', () => approveStage().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderRetry.addEventListener('click', () => retryStage().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderCancel.addEventListener('click', () => cancelSession().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderEnhance.addEventListener('click', () => enhanceStage().catch((e) => { els.builderSessionMeta.textContent = e.message; }));
  els.builderReplayPrev.addEventListener('click', () => { stopReplayTimer(); shiftReplay(-1); });
  els.builderReplayNext.addEventListener('click', () => { stopReplayTimer(); shiftReplay(1); });
  els.builderReplayPlay.addEventListener('click', () => toggleReplay());
  els.builderReplayRange.addEventListener('input', () => {
    stopReplayTimer();
    state.replayIndex = Number(els.builderReplayRange.value || 0);
    if (state.session) renderSession(state.session);
  });
  window.api.onBuilderEvent(onBuilderEvent);

  setWorkspaceTab('builder');
  bootstrapDefaultPath();
})();
