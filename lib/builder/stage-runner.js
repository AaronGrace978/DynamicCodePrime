async function runStage(stage, context, helpers) {
  if (!stage || typeof stage.run !== 'function') {
    return {
      status: 'failed',
      summary: 'Stage is not executable.',
      details: 'Missing stage.run() implementation.',
      changes: [],
    };
  }

  try {
    const result = await stage.run(context, helpers);
    return {
      status: result?.status || 'completed',
      summary: result?.summary || `${stage.title} completed.`,
      details: result?.details || '',
      changes: Array.isArray(result?.changes) ? result.changes : [],
      artifacts: Array.isArray(result?.artifacts) ? result.artifacts : [],
      nextActions: Array.isArray(result?.nextActions) ? result.nextActions : [],
      kind: result?.kind || stage.kind || 'task',
      headline: result?.headline || '',
      awaitApproval: Boolean(result?.awaitApproval),
      metadata: result?.metadata || {},
    };
  } catch (error) {
    return {
      status: 'failed',
      summary: `${stage.title} failed.`,
      details: error.message,
      changes: [],
      artifacts: [],
      nextActions: ['Retry the stage after resolving the reported error.'],
      kind: stage?.kind || 'task',
      headline: '',
      metadata: { stack: error.stack || '' },
    };
  }
}

module.exports = {
  runStage,
};
