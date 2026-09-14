/* global fence, formatUtc */
/** Pure ChatGPT adapter, shared by quick export and the archive explorer. */
const ChatGPTAdapter = (() => {
  'use strict';
  const SKIP_CONTENT_TYPES = new Set([
    'model_editable_context',
    'user_editable_context',
    'system_error',
  ]);
  const THINKING_CONTENT_TYPES = new Set(['thoughts', 'reasoning_recap']);
  const DEEP_RESEARCH_STATE = Symbol('deepResearchState');
  // citation 是私有區 unicode sentinel：\uE200cite\uE202turn0search1\uE201
  // （寫成 escape 而不是直接放字元，那些是看不見的私有區字碼，很容易被編輯器吃掉）
  const CITATION_SENTINEL = /\uE200[\s\S]*?\uE201/g;

  /** 取出目前選中的那條 branch（編輯／重生過的分支自動被排除）。 */
  function buildThread(data) {
    if (Array.isArray(data.linear_conversation) && data.linear_conversation.length > 0) {
      return data.linear_conversation.map((node) => node.message).filter(Boolean);
    }
    // /backend-api/conversation 只回 mapping + current_node，得自己往上走。
    const mapping = data.mapping || {};
    const thread = [];
    const guard = new Set();
    let id = data.current_node;
    while (id && mapping[id] && !guard.has(id)) {
      guard.add(id);
      if (mapping[id].message) thread.push(mapping[id].message);
      id = mapping[id].parent;
    }
    return thread.reverse();
  }

  function looksLikeMessage(value) {
    return (
      !!value &&
      typeof value === 'object' &&
      !!value.author &&
      typeof value.author === 'object' &&
      !!value.content &&
      typeof value.content === 'object'
    );
  }

  function isDeepResearchMessage(message) {
    const sdk = message.metadata?.chatgpt_sdk || {};
    const resource = message.metadata?.invoked_resource || {};
    return [
      sdk.resource_name,
      sdk.attribution_id,
      sdk.resolved_pineapple_uri,
      resource.app_name,
      resource.resource_uri,
    ].some((value) => /deep[_\s-]?research/i.test(String(value || '')));
  }

  function parseWidgetState(value, { strict = false } = {}) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      if (strict) throw new Error(`Deep Research widget state 無法解析：${error.message}`);
      return null;
    }
  }

  /** Deep Research 把最終報告藏在 app widget state，不會放進一般 conversation thread。 */
  function deepResearchInfo(message) {
    const sdk = message.metadata?.chatgpt_sdk;
    if (!sdk || typeof sdk !== 'object') return null;

    const isDeepResearch = isDeepResearchMessage(message);
    const candidates = [
      sdk.widget_state,
      sdk.venus_widget_state,
      sdk.tool_response_metadata?.venus_widget_state,
    ];
    let fallbackState = null;

    for (const candidate of candidates) {
      const state = parseWidgetState(candidate, { strict: isDeepResearch });
      if (!state) continue;
      if (!fallbackState) fallbackState = state;
      if (looksLikeMessage(state.report_message)) {
        return { state, report: state.report_message };
      }
    }

    if (!isDeepResearch) return null;
    if (fallbackState?.status === 'completed') {
      throw new Error('Deep Research 已完成，但找不到可匯出的 report_message。');
    }
    return fallbackState ? { state: fallbackState, report: null } : null;
  }

  function candidateTimestamp(candidate) {
    const values = [
      candidate.state?.last_updated_at,
      candidate.state?.research_stopped_at,
      candidate.report?.update_time,
      candidate.report?.create_time,
      candidate.host?.update_time,
      candidate.host?.create_time,
    ];
    for (const value of values) {
      const time =
        typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
      if (Number.isFinite(time)) return time;
    }
    return 0;
  }

  function attachResearchState(message, state) {
    const copy = { ...message };
    Object.defineProperty(copy, DEEP_RESEARCH_STATE, { value: state });
    return copy;
  }

  function researchInstanceKey(host, index) {
    const sdk = host.metadata?.chatgpt_sdk || {};
    const sessionId =
      sdk.widget_session_id || sdk.tool_response_metadata?.['openai/widgetSessionId'];
    if (sessionId) return `session:${sessionId}`;
    if (sdk.invocation_uuid) return `invocation:${sdk.invocation_uuid}`;
    return host.id ? `host:${host.id}` : `index:${index}`;
  }

  /** 插回 app 內嵌訊息；同一份 report 出現多個 snapshot 時採最新的 completed state。 */
  function expandDeepResearchMessages(messages, opts) {
    const topLevelIds = new Set(messages.map((message) => message.id).filter(Boolean));
    const best = new Map();
    const instancesWithReports = new Set();

    messages.forEach((host, index) => {
      const info = deepResearchInfo(host);
      if (!info) return;
      const instanceKey = researchInstanceKey(host, index);
      // plan_id 可能被不同研究沿用，不能拿它判定兩份報告是同一份。
      const key = info.report?.id
        ? `report-id:${info.report.id}`
        : `${info.report ? 'report-instance' : 'state'}:${instanceKey}`;
      if (info.report) instancesWithReports.add(instanceKey);
      const previous = best.get(key);
      const candidate = {
        ...info,
        host,
        instanceKey,
        // 更新內容不能把較早的回覆移到後來的追問之後。
        hostIndex: previous?.hostIndex ?? index,
      };
      const score = (info.state?.status === 'completed' ? 1e15 : 0) + candidateTimestamp(candidate);
      if (!previous || score >= previous.score) best.set(key, { ...candidate, score });
    });

    const stateForTopLevel = new Map();
    const insertions = new Map();
    for (const candidate of best.values()) {
      if (candidate.report?.id && topLevelIds.has(candidate.report.id)) {
        stateForTopLevel.set(candidate.report.id, candidate.state);
        continue;
      }
      if (
        !candidate.report &&
        (!opts.includeResearchDetails || instancesWithReports.has(candidate.instanceKey))
      )
        continue;

      const message = candidate.report || {
        id: `deep-research-state-${candidate.instanceKey}`,
        author: { role: 'assistant', metadata: {} },
        create_time: candidate.host.update_time || candidate.host.create_time,
        content: { content_type: 'text', parts: [] },
        status: 'finished_successfully',
        recipient: 'all',
      };
      const items = insertions.get(candidate.hostIndex) || [];
      items.push(attachResearchState(message, candidate.state));
      insertions.set(candidate.hostIndex, items);
    }

    const expanded = [];
    messages.forEach((message, index) => {
      expanded.push(
        message.id && stateForTopLevel.has(message.id)
          ? attachResearchState(message, stateForTopLevel.get(message.id))
          : message
      );
      expanded.push(...(insertions.get(index) || []));
    });
    return expanded;
  }

  /** 這串判斷是照 ChatGPT UI 自己的判準寫的。 */
  function visibleMessages(messages, opts) {
    return messages.filter((message) => {
      if (message.metadata?.is_visually_hidden_from_conversation) return false;

      const role = message.author?.role;
      if (role === 'system') return false;

      const contentType = message.content?.content_type;
      if (SKIP_CONTENT_TYPES.has(contentType)) return false;
      if (THINKING_CONTENT_TYPES.has(contentType)) return opts.includeThinking;

      const isToolTraffic = role === 'tool' || (message.recipient && message.recipient !== 'all');
      if (isToolTraffic) return opts.includeTools;

      return true;
    });
  }

  function partToText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.content_type === 'image_asset_pointer')
      return `![image](${part.asset_pointer || 'image'})`;
    if (typeof part.text === 'string') return part.text;
    return fence(JSON.stringify(part, null, 2), 'json');
  }

  function textOf(message) {
    const content = message.content || {};
    const parts = Array.isArray(content.parts)
      ? content.parts.map(partToText).filter(Boolean)
      : null;

    switch (content.content_type) {
      case 'text':
      case 'multimodal_text':
        return parts ? parts.join('\n\n') : '';
      case 'code': {
        const lang = content.language && content.language !== 'unknown' ? content.language : '';
        return fence(content.text ?? (parts ? parts.join('\n') : ''), lang);
      }
      case 'execution_output':
        return fence(content.text ?? '', 'text');
      case 'thoughts':
        return (content.thoughts || [])
          .map((t) => [t.summary && `**${t.summary}**`, t.content].filter(Boolean).join('\n\n'))
          .join('\n\n');
      case 'reasoning_recap':
        return String(content.content ?? content.text ?? '');
      case 'tether_browsing_display':
      case 'tether_quote':
        return String(content.result ?? content.text ?? '');
      default:
        // 未知型態（Deep Research、canvas 之類的新東西）不靜默丟掉，寧可留 JSON。
        if (parts && parts.length > 0) return parts.join('\n\n');
        if (typeof content.text === 'string') return content.text;
        return fence(JSON.stringify(content, null, 2), 'json');
    }
  }

  /**
   * 把 sentinel 換成 content_references 提供的現成 markdown 連結。
   *
   * 這裡只換「那一段」而不是全文 replace，是踩過坑的：`sources_footnote` 型的
   * ref 的 matched_text 是**一個半形空白**、alt 是空字串。全文 split/join 會把整篇
   * 文章的空白全部刪光（中英混排看起來就像整段黏在一起）。
   */
  function applyCitations(text, message) {
    const refs = (message.metadata?.content_references || []).filter(
      (ref) => typeof ref.matched_text === 'string' && ref.matched_text.trim() !== ''
    );
    let out = text;
    // 由後往前換，前面那些 start_idx 才不會被前一次替換推掉。
    for (const ref of [...refs].sort((a, b) => (b.start_idx ?? -1) - (a.start_idx ?? -1))) {
      const alt = ref.alt || '';
      const { start_idx: start, end_idx: end } = ref;
      if (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        out.slice(start, end) === ref.matched_text
      ) {
        out = out.slice(0, start) + alt + out.slice(end);
        continue;
      }
      const at = out.indexOf(ref.matched_text); // index 對不上時退而求其次，只換第一個
      if (at >= 0) out = out.slice(0, at) + alt + out.slice(at + ref.matched_text.length);
    }
    // 有些 sentinel（例如 inline url 型）不會出現在 content_references 裡，掃掉。
    return out.replace(CITATION_SENTINEL, '');
  }

  function roleOf(message) {
    const role = message.author?.role;
    if (role === 'user') return 'User';
    if (role === 'tool') return `Tool (${message.author?.name || 'tool'})`;
    if (message.recipient && message.recipient !== 'all') return `Assistant → ${message.recipient}`;
    return 'Assistant';
  }

  function researchDetailsOf(message) {
    const state = message[DEEP_RESEARCH_STATE];
    if (!state) return '';

    const clean = (value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const lines = ['> **Deep Research details**'];
    if (state.status) lines.push(`> Status: \`${clean(state.status)}\``);
    if (state.research_started_at) lines.push(`> Started: ${formatUtc(state.research_started_at)}`);
    if (state.research_stopped_at)
      lines.push(`> Finished: ${formatUtc(state.research_stopped_at)}`);

    const plan = state.plan;
    if (plan?.title) lines.push('>', `> Plan: **${clean(plan.title)}**`);
    for (const step of plan?.steps || []) {
      const status = clean(step.status || 'pending');
      const marker = status === 'completed' ? 'x' : ' ';
      const suffix = status === 'pending' || status === 'completed' ? '' : ` _(${status})_`;
      lines.push(`> - [${marker}] ${clean(step.text)}${suffix}`);
    }
    return lines.join('\n');
  }

  /** 把 ChatGPT 的對話 JSON 轉成 shared/chat-export.js 吃的正規化 doc。 */
  function normalize(data, ctx, opts) {
    const messages = expandDeepResearchMessages(buildThread(data), opts);
    const sections = visibleMessages(messages, opts).map((message) => {
      const role = roleOf(message);
      const details = opts.includeResearchDetails ? researchDetailsOf(message) : '';
      const body = applyCitations(textOf(message), message);
      return {
        role,
        model: role === 'Assistant' ? message.metadata?.model_slug || '' : '',
        time: message.create_time,
        body: [details, body].filter(Boolean).join('\n\n'),
      };
    });

    return {
      source: 'chatgpt',
      sourceLabel: 'ChatGPT',
      title: data.title || 'ChatGPT conversation',
      url: ctx.url,
      ids: { conversation_id: data.conversation_id || data.id || '' },
      model: data.default_model_slug || '',
      createdAt: data.create_time,
      sections,
    };
  }

  return Object.freeze({
    normalize,
    buildThread,
    deepResearchInfo,
    researchInstanceKey,
    candidateTimestamp,
    textOf,
    applyCitations,
    roleOf,
    visibleMessages,
    attachResearchState,
    researchDetailsOf,
  });
})();
