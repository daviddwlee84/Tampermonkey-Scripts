/* global ChatGPTAdapter, formatUtc, handoffHeader, yaml */
/** Versioned, portable graph and explicit selection. No DOM, GM, or network calls. */
const ConversationArchive = (() => {
  'use strict';
  const FORMAT = 'chat-export-archive';
  const VERSION = 1;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const defaults = () => ({ showTools: false, showThinking: false, includeResearchDetails: false });
  const key = (...parts) => parts.map((part) => encodeURIComponent(String(part))).join(':');
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

  function visible(block, options = {}) {
    if (block.category === 'tool') return options.showTools === true;
    if (block.category === 'thinking') return options.showThinking === true;
    if (block.kind === 'research-state') return options.includeResearchDetails === true;
    return true;
  }

  function pathIds(archive, endId = archive.graph.currentNodeId) {
    const result = [],
      seen = new Set();
    let id = endId;
    while (id && own(archive.graph.nodes, id)) {
      if (seen.has(id)) throw new Error('對話節點形成循環。');
      seen.add(id);
      result.push(id);
      id = archive.graph.nodes[id].parentId;
    }
    return result.reverse();
  }

  /** Keep report snapshots separate in storage; collapse only the requested path. */
  function pathBlocks(archive, endId, options = archive.selection.options) {
    const ids = pathIds(archive, endId);
    const all = ids.flatMap((id) =>
      archive.graph.nodes[id].blockIds.map((bid) => archive.graph.blocks[bid])
    );
    const best = new Map(),
      first = new Map(),
      reported = new Set();
    const ordinaryIds = new Set(all.filter((b) => b.kind === 'message').map((b) => b.messageId));
    for (const block of all) {
      if (block.kind === 'research') {
        reported.add(block.instanceKey);
        if (!first.has(block.reportKey)) first.set(block.reportKey, block.id);
        if (!best.has(block.reportKey) || block.score >= best.get(block.reportKey).score)
          best.set(block.reportKey, block);
      } else if (block.kind === 'research-state') {
        const stateKey = `state:${block.instanceKey}`;
        if (!first.has(stateKey)) first.set(stateKey, block.id);
        if (!best.has(stateKey) || block.score >= best.get(stateKey).score)
          best.set(stateKey, block);
      }
    }
    const result = [];
    for (const original of all) {
      let block = original;
      if (block.kind === 'research') {
        if (first.get(block.reportKey) !== block.id) continue;
        block = best.get(block.reportKey);
        if (block.messageId && ordinaryIds.has(block.messageId)) continue;
      } else if (block.kind === 'research-state') {
        const stateKey = `state:${block.instanceKey}`;
        if (reported.has(block.instanceKey) || first.get(stateKey) !== block.id) continue;
        block = best.get(stateKey);
      }
      if (visible(block, options)) result.push({ ...block, placementNodeId: original.nodeId });
    }
    return result;
  }

  function fromChatGPT(input, context = {}) {
    const raw = clone(input?.data?.mapping ? input.data : input);
    if (!record(raw?.mapping)) throw new Error('不是支援的 ChatGPT 原始 JSON。');
    const nodes = Object.create(null),
      blocks = Object.create(null);
    const A = ChatGPTAdapter;
    for (const [id, native] of Object.entries(raw.mapping)) {
      if (!record(native)) throw new Error(`節點格式有誤：${id}`);
      nodes[id] = {
        id,
        parentId: typeof native.parent === 'string' ? native.parent : null,
        children: [],
        blockIds: [],
      };
    }
    const roots = [];
    for (const node of Object.values(nodes)) {
      if (node.parentId && !own(nodes, node.parentId)) {
        node.missingParentId = node.parentId;
        node.parentId = null;
      }
      if (node.parentId) nodes[node.parentId].children.push(node.id);
      else roots.push(node.id);
      const nativeOrder = raw.mapping[node.id].children || [];
      if (!Array.isArray(nativeOrder)) throw new Error(`children 格式有誤：${node.id}`);
    }
    for (const node of Object.values(nodes)) {
      const rank = new Map((raw.mapping[node.id].children || []).map((id, i) => [id, i]));
      node.children.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
    }
    const graph = {
      roots,
      currentNodeId: raw.current_node || raw.linear_conversation?.at(-1)?.id || roots[0] || null,
      nodes,
      blocks,
    };
    validateTree(graph);

    const add = (node, message, extra) => {
      const type = message.content?.content_type;
      const category = ['thoughts', 'reasoning_recap'].includes(type)
        ? 'thinking'
        : message.author?.role === 'tool' || (message.recipient && message.recipient !== 'all')
          ? 'tool'
          : 'dialogue';
      const block = {
        id: key('message', node.id),
        nodeId: node.id,
        messageId: message.id || '',
        kind: 'message',
        category,
        role: A.roleOf(message),
        model: message.metadata?.model_slug || '',
        time: message.create_time ?? null,
        markdown: A.applyCitations(A.textOf(message), message),
        details: '',
        ...extra,
      };
      if (!block.markdown.trim() && !block.details && !block.error) return;
      blocks[block.id] = block;
      node.blockIds.push(block.id);
    };

    for (const node of Object.values(nodes)) {
      const host = raw.mapping[node.id].message;
      if (!host) continue;
      if (A.visibleMessages([host], { includeTools: true, includeThinking: true }).length)
        add(node, host);
      try {
        const info = A.deepResearchInfo(host);
        if (!info) continue;
        const instanceKey = A.researchInstanceKey({ ...host, id: host.id || node.id }, 0);
        const score =
          (info.state?.status === 'completed' ? 1e15 : 0) + A.candidateTimestamp({ ...info, host });
        const message = info.report || {
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: [] },
          create_time: host.create_time,
        };
        const reportKey = info.report?.id
          ? `report-id:${info.report.id}`
          : `report-instance:${instanceKey}`;
        add(node, message, {
          id: key(info.report ? 'report' : 'state', node.id, info.report?.id || instanceKey),
          kind: info.report ? 'research' : 'research-state',
          category: 'dialogue',
          reportKey,
          instanceKey,
          score,
          details: A.researchDetailsOf(A.attachResearchState(message, info.state)),
        });
      } catch (error) {
        add(
          node,
          { author: { role: 'assistant' }, content: { content_type: 'text', parts: [] } },
          {
            id: key('error', node.id),
            kind: 'error',
            error: String(error.message),
            category: 'dialogue',
          }
        );
      }
    }
    const options = { ...defaults(), ...context.options };
    const archive = {
      format: FORMAT,
      version: VERSION,
      source: {
        provider: 'chatgpt',
        conversationId: raw.conversation_id || raw.id || '',
        title: raw.title || 'ChatGPT conversation',
        url: context.url || '',
        capturedAt: context.capturedAt || new Date().toISOString(),
        type: context.type || 'imported-json',
        coverage: 'returned-nodes',
      },
      graph,
      raw,
      selection: { blockIds: [], options },
    };
    archive.selection.blockIds = pathBlocks(archive, graph.currentNodeId, options).map(
      (block) => block.id
    );
    return archive;
  }

  function validateTree(graph) {
    if (
      !record(graph) ||
      !record(graph.nodes) ||
      !record(graph.blocks) ||
      !Array.isArray(graph.roots)
    )
      throw new Error('對話樹格式不完整。');
    const visited = new Set(),
      roots = new Set(graph.roots);
    if (roots.size !== graph.roots.length) throw new Error('根節點 ID 重複。');
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (
        !record(node) ||
        node.id !== id ||
        !Array.isArray(node.children) ||
        !Array.isArray(node.blockIds)
      )
        throw new Error(`節點格式有誤：${id}`);
      if (
        node.parentId !== null &&
        (typeof node.parentId !== 'string' || !own(graph.nodes, node.parentId))
      )
        throw new Error(`找不到上游節點：${id}`);
      if (roots.has(id) !== (node.parentId === null)) throw new Error('根節點關係不一致。');
      if (
        new Set(node.children).size !== node.children.length ||
        new Set(node.blockIds).size !== node.blockIds.length
      )
        throw new Error(`節點引用重複：${id}`);
      for (const child of node.children)
        if (!own(graph.nodes, child) || graph.nodes[child].parentId !== id)
          throw new Error(`父子關係不一致：${id}`);
      if (node.parentId !== null && !graph.nodes[node.parentId].children.includes(id))
        throw new Error(`父子關係不一致：${id}`);
    }
    for (const root of roots) if (!own(graph.nodes, root)) throw new Error('找不到根節點。');
    for (const id of Object.keys(graph.nodes)) {
      const walking = new Set();
      let cursor = id;
      while (cursor !== null && !visited.has(cursor)) {
        if (walking.has(cursor)) throw new Error('對話節點形成循環。');
        walking.add(cursor);
        cursor = graph.nodes[cursor].parentId;
      }
      for (const item of walking) visited.add(item);
    }
    if (graph.currentNodeId !== null && !own(graph.nodes, graph.currentNodeId))
      throw new Error('找不到目前節點。');
  }

  function load(input, context = {}) {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    if (value?.format === undefined) return fromChatGPT(value, context);
    if (value.format !== FORMAT || value.version !== VERSION)
      throw new Error('不支援的存檔格式或版本。');
    const archive = clone(value);
    validateTree(archive.graph);
    if (
      !record(archive.source) ||
      typeof archive.source.title !== 'string' ||
      typeof archive.source.provider !== 'string' ||
      typeof archive.source.conversationId !== 'string' ||
      typeof archive.source.url !== 'string' ||
      typeof archive.source.capturedAt !== 'string' ||
      !record(archive.raw) ||
      !record(archive.selection) ||
      !Array.isArray(archive.selection.blockIds) ||
      !record(archive.selection.options)
    )
      throw new Error('存檔資料不完整。');
    const { nodes, blocks } = archive.graph;
    for (const [id, block] of Object.entries(blocks)) {
      if (
        !record(block) ||
        block.id !== id ||
        !own(nodes, block.nodeId) ||
        !nodes[block.nodeId].blockIds.includes(id) ||
        typeof block.markdown !== 'string' ||
        typeof block.role !== 'string' ||
        typeof block.details !== 'string' ||
        !['message', 'research', 'research-state', 'error'].includes(block.kind) ||
        !['dialogue', 'tool', 'thinking'].includes(block.category)
      )
        throw new Error(`訊息 block 格式有誤：${id}`);
      if (
        (block.kind === 'research' || block.kind === 'research-state') &&
        (typeof block.reportKey !== 'string' ||
          typeof block.instanceKey !== 'string' ||
          !Number.isFinite(block.score))
      )
        throw new Error('研究識別資料不完整。');
      if (block.kind === 'error' && typeof block.error !== 'string')
        throw new Error('錯誤訊息格式不完整。');
    }
    for (const node of Object.values(nodes))
      for (const id of node.blockIds)
        if (!own(blocks, id) || blocks[id].nodeId !== node.id)
          throw new Error('找不到訊息 block。');
    if (archive.selection.blockIds.some((id) => !own(blocks, id)))
      throw new Error('選取內容引用不存在的訊息。');
    archive.selection.blockIds = [...new Set(archive.selection.blockIds)];
    archive.selection.options = { ...defaults(), ...archive.selection.options };
    return archive;
  }

  function withSelection(archive, ids, options = archive.selection.options) {
    const result = {
      ...archive,
      selection: { blockIds: [...new Set(ids)], options: { ...options } },
    };
    if (result.selection.blockIds.some((id) => !own(archive.graph.blocks, id)))
      throw new Error('選取內容已不存在，請重新讀取。');
    return result;
  }

  /** A pruned source tree keeps shared ancestors once, without exporting their text. */
  function selectionEvents(archive, selectedIds = archive.selection.blockIds) {
    const { nodes, blocks } = archive.graph;
    const selected = new Set(selectedIds),
      relevant = new Set(),
      byNode = new Map();
    for (const id of selected) {
      const block = blocks[id];
      if (!block) throw new Error('選取內容已不存在。');
      if (block.error) throw new Error(`無法匯出所選訊息：${block.error}`);
      const list = byNode.get(block.nodeId) || [];
      list.push(block);
      byNode.set(block.nodeId, list);
      let cursor = block.nodeId;
      while (cursor && !relevant.has(cursor)) {
        relevant.add(cursor);
        cursor = nodes[cursor].parentId;
      }
    }
    const events = [],
      rootIds = archive.graph.roots.filter((id) => relevant.has(id));
    // Reposition late snapshots within a linear segment. A selected fork starts
    // a new segment so a branch-specific revision can never become shared context.
    const positions = new Map(),
      groups = [];
    const segments = rootIds.map((id) => ({ id, first: new Map() }));
    while (segments.length) {
      let { id, first } = segments.pop();
      while (id) {
        for (const bid of nodes[id].blockIds) {
          const block = blocks[bid];
          if (!['research', 'research-state'].includes(block.kind)) continue;
          const identity = `${block.kind}:${block.kind === 'research' ? block.reportKey : block.instanceKey}`;
          if (!first.has(identity)) {
            const group = { nodeId: id, blockIds: [], selected: false };
            first.set(identity, group);
            groups.push(group);
          }
          const group = first.get(identity);
          group.blockIds.push(bid);
          if (selected.has(bid)) {
            group.selected = true;
            positions.set(bid, group.nodeId);
          }
        }
        const children = nodes[id].children.filter((child) => relevant.has(child));
        if (children.length > 1) {
          for (const child of children) segments.push({ id: child, first: new Map() });
          break;
        }
        id = children[0];
      }
    }
    const represented = new Set(
      groups.filter((group) => group.selected).flatMap((group) => group.blockIds)
    );
    const omitted = (id) => visible(blocks[id], {}) && !selected.has(id) && !represented.has(id);
    byNode.clear();
    for (const id of selected) {
      const block = blocks[id],
        at = positions.get(id) || block.nodeId;
      const list = byNode.get(at) || [];
      list.push(block);
      byNode.set(at, list);
    }
    const stack = rootIds
      .map((id, index) => ({
        id,
        branch: rootIds.length > 1 ? `${index + 1}` : '',
        last: null,
        gap: false,
      }))
      .reverse();
    while (stack.length) {
      let { id, branch, last, gap } = stack.pop();
      if (branch) events.push({ type: 'branch', label: branch, from: last });
      while (id) {
        const node = nodes[id];
        if (node.missingParentId) gap = true;
        const chosen = byNode.get(id) || [];
        if (chosen.length) {
          const position = (block) => {
            const direct = node.blockIds.indexOf(block.id);
            return direct >= 0
              ? direct
              : node.blockIds.findIndex(
                  (bid) => block.reportKey && blocks[bid].reportKey === block.reportKey
                );
          };
          chosen.sort((a, b) => position(a) - position(b));
          let cursor = 0;
          for (const block of chosen) {
            const at = position(block);
            if (node.blockIds.slice(cursor, at).some(omitted)) gap = true;
            if (gap) events.push({ type: 'omission' });
            gap = false;
            events.push({ type: 'block', block });
            last = block.id;
            cursor = Math.max(cursor, at + 1);
          }
          if (node.blockIds.slice(cursor).some(omitted)) gap = true;
        } else if (node.blockIds.some(omitted)) gap = true;
        const children = node.children.filter((child) => relevant.has(child));
        if (children.length > 1) {
          // Sibling order comes from the original tree, never timestamps.
          for (let i = children.length - 1; i >= 0; i--)
            stack.push({
              id: children[i],
              branch: branch ? `${branch}.${i + 1}` : `${i + 1}`,
              last,
              gap,
            });
          break;
        }
        id = children[0];
      }
    }
    return events;
  }

  function renderSelection(archive, options = {}) {
    const events = selectionEvents(archive),
      units = events.filter((event) => event.type === 'block');
    if (!units.length) throw new Error('請先選取訊息或加入整條 path。');
    const numbers = new Map(units.map(({ block }, i) => [block.id, i + 1]));
    const lines = [
      '---',
      `source: ${yaml(archive.source.provider)}`,
      `title: ${yaml(archive.source.title)}`,
      `url: ${yaml(archive.source.url || '')}`,
      `conversation_id: ${yaml(archive.source.conversationId || '')}`,
      'export_scope: selection',
      `messages: ${units.length}`,
      `exported_at: ${yaml(options.exportedAt || new Date().toISOString())}`,
      'exporter: "chatgpt-export-markdown v1.4.0"',
      '---',
      '',
      options.handoff
        ? handoffHeader(archive.source.provider === 'chatgpt' ? 'ChatGPT' : archive.source.provider)
        : `# ${archive.source.title}`,
      '',
    ];
    for (const event of events) {
      if (event.type === 'omission') lines.push('> 此處省略未選取的前文。', '');
      else if (event.type === 'branch') {
        lines.push(
          `## 分支 ${event.label}`,
          '',
          event.from
            ? `> 接續訊息 M${numbers.get(event.from)}；與其他同層分支互為替代路徑。`
            : '> 此分支的共同前文未選取，或不在來源快照中。',
          ''
        );
      } else {
        const block = event.block,
          number = numbers.get(block.id);
        const label = [block.model, formatUtc(block.time)].filter(Boolean).join(', ');
        lines.push(
          `<!-- message: M${number} -->`,
          `_**${block.role}${label ? ` (${label})` : ''} · M${number}**_`,
          ''
        );
        if (archive.selection.options.includeResearchDetails && block.details)
          lines.push(block.details, '');
        lines.push(block.markdown, '', '---', '');
      }
    }
    return lines.join('\n');
  }

  return Object.freeze({
    FORMAT,
    VERSION,
    defaults,
    visible,
    pathIds,
    pathBlocks,
    fromChatGPT,
    load,
    withSelection,
    selectionEvents,
    renderSelection,
  });
})();
