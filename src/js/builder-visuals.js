/**
 * DynamicCodePrime - Builder visualization helpers
 * Renders the project graph and small formatting helpers for the staged builder.
 */

(function exposeBuilderVisuals() {
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(durationMs) {
    if (!durationMs || Number.isNaN(durationMs)) return 'n/a';
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
  }

  function typeClass(type) {
    return String(type || 'file').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  }

  function renderProjectGraph(container, graph, selectedNodeId, onNodeSelect) {
    if (!container) return;
    container.innerHTML = '';

    if (!graph?.nodes?.length) {
      container.innerHTML = '<div class="builder-graph-empty">No graph yet. Run or load a build session.</div>';
      return;
    }

    const columns = new Map();
    for (const node of graph.nodes) {
      const depth = Number(node.depth || 0);
      if (!columns.has(depth)) columns.set(depth, []);
      columns.get(depth).push(node);
    }

    const horizontalGap = 220;
    const verticalGap = 90;
    const paddingX = 24;
    const paddingY = 28;
    const width = Math.max(720, (columns.size * horizontalGap) + paddingX * 2);
    const tallestColumn = Math.max(...Array.from(columns.values()).map((entries) => entries.length), 1);
    const height = Math.max(280, (tallestColumn * verticalGap) + paddingY * 2);

    const positionedNodes = new Map();
    for (const [depth, entries] of columns.entries()) {
      entries.forEach((node, index) => {
        positionedNodes.set(node.id, {
          ...node,
          x: paddingX + (depth * horizontalGap),
          y: paddingY + (index * verticalGap),
        });
      });
    }

    const edgeSvg = (graph.edges || []).map((edge) => {
      const from = positionedNodes.get(edge.from);
      const to = positionedNodes.get(edge.to);
      if (!from || !to) return '';
      const x1 = from.x + 156;
      const y1 = from.y + 24;
      const x2 = to.x;
      const y2 = to.y + 24;
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 - 8;
      return `
        <path class="builder-graph-edge" d="M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}" />
        <text class="builder-graph-edge-label" x="${labelX}" y="${labelY}">${escapeHtml(edge.label || '')}</text>
      `;
    }).join('');

    const nodeSvg = Array.from(positionedNodes.values()).map((node) => {
      const isSelected = node.id === selectedNodeId;
      return `
        <g class="builder-graph-node ${typeClass(node.type)} ${isSelected ? 'selected' : ''}" data-node-id="${escapeHtml(node.id)}">
          <rect x="${node.x}" y="${node.y}" rx="12" ry="12" width="156" height="48"></rect>
          <text class="builder-graph-node-label" x="${node.x + 12}" y="${node.y + 21}">${escapeHtml(node.label || node.path || node.id)}</text>
          <text class="builder-graph-node-meta" x="${node.x + 12}" y="${node.y + 37}">${escapeHtml(node.type || 'file')}</text>
        </g>
      `;
    }).join('');

    const wrapper = document.createElement('div');
    wrapper.className = 'builder-graph-wrapper';
    wrapper.innerHTML = `
      <svg class="builder-graph-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
        <g class="builder-graph-layer edges">${edgeSvg}</g>
        <g class="builder-graph-layer nodes">${nodeSvg}</g>
      </svg>
    `;

    wrapper.querySelectorAll('[data-node-id]').forEach((nodeEl) => {
      nodeEl.addEventListener('click', () => {
        const { nodeId } = nodeEl.dataset;
        if (typeof onNodeSelect === 'function') {
          onNodeSelect(nodeId);
        }
      });
    });

    container.appendChild(wrapper);
  }

  window.BuilderVisuals = {
    formatDuration,
    renderProjectGraph,
  };
})();
