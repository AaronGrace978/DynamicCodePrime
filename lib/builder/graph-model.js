const path = require('path');

function normalizeArtifactPath(targetPath, artifactPath) {
  if (!artifactPath) return '';
  const value = String(artifactPath).replace(/\\/g, '/');
  if (value === '.' || value === './') return '.';
  if (path.isAbsolute(artifactPath)) {
    const rel = path.relative(targetPath, artifactPath).replace(/\\/g, '/');
    return rel || '.';
  }
  return value.replace(/^\.\//, '') || '.';
}

function inferNodeType(relPath) {
  if (relPath === '.') return 'workspace';
  const last = relPath.split('/').pop() || '';
  if (!last.includes('.')) return 'directory';
  const ext = last.split('.').pop().toLowerCase();
  if (['md', 'txt'].includes(ext)) return 'document';
  if (['json', 'toml', 'yaml', 'yml'].includes(ext)) return 'config';
  if (['rs', 'js', 'ts', 'tsx', 'py'].includes(ext)) return 'source';
  return 'file';
}

function createEmptyGraph(targetPath) {
  return {
    nodes: [{
      id: 'workspace:.',
      label: path.basename(targetPath) || 'workspace',
      path: '.',
      type: 'workspace',
      depth: 0,
      createdByStageIds: [],
      touchedByStageIds: [],
    }],
    edges: [],
    stats: {
      nodeCount: 1,
      edgeCount: 0,
      maxDepth: 0,
    },
  };
}

function buildProjectGraph(session) {
  if (!session?.targetPath) {
    return createEmptyGraph('.');
  }

  const nodes = new Map();
  const edges = new Map();

  function ensureNode(relPath, patch = {}) {
    const normalized = normalizeArtifactPath(session.targetPath, relPath);
    const nodeId = `workspace:${normalized}`;
    if (!nodes.has(nodeId)) {
      const depth = normalized === '.' ? 0 : normalized.split('/').length;
      const base = {
        id: nodeId,
        label: normalized === '.' ? (path.basename(session.targetPath) || 'workspace') : normalized.split('/').pop(),
        path: normalized,
        type: inferNodeType(normalized),
        depth,
        createdByStageIds: [],
        touchedByStageIds: [],
      };
      nodes.set(nodeId, base);
    }
    const existing = nodes.get(nodeId);
    const merged = {
      ...existing,
      ...patch,
      createdByStageIds: Array.from(new Set([...(existing.createdByStageIds || []), ...(patch.createdByStageIds || [])])),
      touchedByStageIds: Array.from(new Set([...(existing.touchedByStageIds || []), ...(patch.touchedByStageIds || [])])),
    };
    nodes.set(nodeId, merged);
    return merged;
  }

  function ensureParentChain(relPath, stageId) {
    const normalized = normalizeArtifactPath(session.targetPath, relPath);
    if (!normalized || normalized === '.') {
      ensureNode('.', { touchedByStageIds: stageId ? [stageId] : [] });
      return;
    }
    const parts = normalized.split('/');
    for (let index = 0; index < parts.length; index += 1) {
      const current = parts.slice(0, index + 1).join('/');
      const currentNode = ensureNode(current, { touchedByStageIds: stageId ? [stageId] : [] });
      const parentPath = index === 0 ? '.' : parts.slice(0, index).join('/');
      const parentNode = ensureNode(parentPath, { touchedByStageIds: stageId ? [stageId] : [] });
      const edgeId = `${parentNode.id}->${currentNode.id}`;
      if (!edges.has(edgeId)) {
        edges.set(edgeId, {
          id: edgeId,
          from: parentNode.id,
          to: currentNode.id,
          label: 'contains',
        });
      }
    }
  }

  ensureNode('.', { type: 'workspace' });

  for (const stage of session.stages || []) {
    const stageArtifacts = Array.isArray(stage.artifacts) ? stage.artifacts : [];
    for (const artifact of stageArtifacts) {
      const normalized = normalizeArtifactPath(session.targetPath, artifact);
      ensureParentChain(normalized, stage.id);
      ensureNode(normalized, {
        createdByStageIds: stage.status === 'completed' ? [stage.id] : [],
        touchedByStageIds: [stage.id],
      });
    }

    const graph = stage.metadata?.graph;
    if (graph?.nodes) {
      for (const node of graph.nodes) {
        ensureNode(node.path || node.id || '.', {
          label: node.label,
          type: node.type || inferNodeType(node.path || node.id || '.'),
          createdByStageIds: stage.status === 'completed' ? [stage.id] : [],
          touchedByStageIds: [stage.id],
        });
      }
    }
    if (graph?.edges) {
      for (const edge of graph.edges) {
        const fromNode = ensureNode(edge.from || '.', { touchedByStageIds: [stage.id] });
        const toNode = ensureNode(edge.to || '.', { touchedByStageIds: [stage.id] });
        const edgeId = `${fromNode.id}->${toNode.id}:${edge.label || 'rel'}`;
        if (!edges.has(edgeId)) {
          edges.set(edgeId, {
            id: edgeId,
            from: fromNode.id,
            to: toNode.id,
            label: edge.label || 'relates_to',
          });
        }
      }
    }
  }

  const graphNodes = Array.from(nodes.values()).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const graphEdges = Array.from(edges.values());
  return {
    nodes: graphNodes,
    edges: graphEdges,
    stats: {
      nodeCount: graphNodes.length,
      edgeCount: graphEdges.length,
      maxDepth: Math.max(...graphNodes.map((node) => node.depth), 0),
    },
  };
}

module.exports = {
  buildProjectGraph,
  normalizeArtifactPath,
};
