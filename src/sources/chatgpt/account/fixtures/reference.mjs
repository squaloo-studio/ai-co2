// The counting rule as it was first written down and checked: one function over a whole export held in
// memory. It is kept as a second, independent implementation. The tests run it and the real code
// (count.ts) on the same made-up conversations and expect the same rows and the same six bases.
// It is not used by the page. It trusts its input, so it must only ever see made-up test data.
//
// The rule in short: every run of assistant messages is one request. It reads its new messages and the
// previous answer as fresh input, and the earlier prompt again: as a cache read within 30 minutes of the
// previous request of the conversation, as fresh input after that.
//
// Four rules were changed here and in count.ts together, after a review against the build spec: citation
// markers are taken out before counting; a message with no time has its nearest ancestor's time, then the
// conversation's create_time; the model of a request follows the spec's chain, and "auto" is no model; the
// assumed thinking time is the median, so the mean of the two middle values when their number is even.
// And "research" and "deep-research" are thinking models by name.
export const WINDOW_DAYS = 30;
export const WARM_MINUTES = 30;          // a re-read within this gap is counted as a cache read
export const DEFAULT_THINK_SECONDS = 15; // for a thinking answer with no recorded time and no other timed answer
export const CAP = {                     // visible re-read text that fits, in tokens: total window minus 20,000 (an assumption)
  plus: { instant: 34000, thinking: 236000 },
  free: { instant: 7000, thinking: 7000 },
};
// Size of the hidden system prompt relative to today's, by date of the request.
export const PROMPT_PERIODS = [
  ['2024-05-01', 0.04], ['2025-08-01', 0.12], ['2026-03-01', 0.65], ['2026-08-01', 0.8], ['9999-01-01', 1],
];
export const PROMPT_MINI = 0.06;

// The model thinks, going by its name alone.
export const isThinkingSlug = s => /thinking|-t-mini$|-pro$|^o\d|^research$|deep-research/.test(s || '');
const kindOf = s => (isThinkingSlug(s) ? 'thinking' : 'instant');
export const promptWeight = (slug, t) => {
  if (/mini|nano/.test(slug || '') && !isThinkingSlug(slug)) return PROMPT_MINI;
  const d = new Date((Number.isFinite(t) ? t : 0) * 1000).toISOString().slice(0, 10);
  for (const [until, w] of PROMPT_PERIODS) if (d < until) return w;
  return 1;
};

export function recapSeconds(msg) {
  const md = msg.metadata || {};
  if (typeof md.finished_duration_sec === 'number' && md.finished_duration_sec >= 0) return md.finished_duration_sec;
  const t = String(msg.content?.content || '');
  const h = /(\d+)\s*h(?:ours?|rs?)?\b/.exec(t), m = /(\d+)\s*m(?:in(?:ute)?s?)?\b/.exec(t), s = /(\d+)\s*s(?:ec(?:ond)?s?)?\b/.exec(t);
  if (h || m || s) return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0);
  if (/couple of seconds/.test(t)) return 2;
  if (/few seconds/.test(t)) return 4;
  if (/a second/.test(t)) return 1;
  if (/couple of minutes/.test(t)) return 120;
  if (/few minutes/.test(t)) return 240;
  if (/a minute/.test(t)) return 60;
  return null;
}

// OpenAI's image guide, patch rule at "high" detail: 32 px patches, a budget of 2,500 patches, times 1.2.
// At the API's default detail on GPT-5.5 and later the budget is 10,000 patches or none, so a large photo can cost 4 to 5 times more.
export function imageTokens(w, h, budget = 2500) {
  if (!(w > 0 && h > 0)) return 1229;     // unknown size: a 1024 x 1024 image
  let patches = Math.ceil(w / 32) * Math.ceil(h / 32);
  if (patches > budget) {
    const f = Math.sqrt((1024 * budget) / (w * h));
    const g = f * Math.min(Math.floor(w * f / 32) / (w * f / 32), Math.floor(h * f / 32) / (h * f / 32));
    patches = Math.min(budget, Math.ceil(Math.floor(w * g) / 32) * Math.ceil(Math.floor(h * g) / 32));
  }
  return Math.ceil(patches * 1.2);
}

// Citation markers: from U+E200 to the next U+E201, then any character left in U+E200 to U+E20F.
const stripMarkers = s => s.replace(/\uE200[^\uE201]*\uE201/g, '').replace(/[\uE200-\uE20F]/g, '');
// Unix seconds. A value above 10^11 is in milliseconds.
const seconds = t => (Number.isFinite(t) && t > 0 ? (t > 1e11 ? t / 1000 : t) : null);
const median = sorted => (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

function visibleText(msg) {
  const c = msg.content || {}; const out = [];
  switch (c.content_type) {
    case 'text': case 'multimodal_text':
      for (const p of c.parts || []) {
        if (typeof p === 'string') out.push(p);
        else if (p?.content_type === 'audio_transcription') out.push(p.text || '');
      }
      break;
    case 'code': case 'execution_output': case 'tether_quote': case 'system_error': out.push(typeof c.text === 'string' ? c.text : ''); break;
    case 'tether_browsing_display': out.push(typeof c.result === 'string' ? c.result : ''); break;
    case 'user_editable_context': out.push(c.user_profile || '', c.user_instructions || ''); break;
    default: break;                       // thoughts, reasoning_recap and unknown types: nothing
  }
  return out.map(p => stripMarkers(String(p))).join('\n');
}

const add = (o, k, f, v) => { if (!v) return; (o[k] ||= { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0 })[f] += v; };

export function readExport(conversations, { countTokens, plus = null, exportTime = null, caps = null } = {}) {
  const tok = s => (s ? countTokens(s, { disallowedSpecial: new Set() }) : 0);
  if (exportTime == null) { exportTime = 0; for (const c of conversations) if (c?.update_time > exportTime) exportTime = c.update_time; }
  const since = exportTime - WINDOW_DAYS * 86400;
  caps ||= plus === false ? CAP.free : CAP.plus;
  const mk = () => ({ rows: {}, thinking: {}, prompt: {}, personal: {}, search: {}, files: {}, misses: {},
    counts: { requests: 0, cold: 0, thinkingTimed: 0, thinkingImputed: 0, recapsNotPlaced: 0, searchAnswers: 0, sources: 0, filesExact: 0, filesEstimated: 0, images: 0, truncated: 0, customInstructionsInExport: 0, memorySeen: 0, afterWindowEnd: 0 },
    gaps: { m5: 0, m10: 0, m30: 0, m60: 0, later: 0 } });   // re-read tokens by time since the previous request
  const out = { window: mk(), all: mk(), exportTime };
  const each = (t, fn) => { fn(out.all); if (t >= since && t <= exportTime) fn(out.window); };

  for (const c of conversations) {
    const map = c?.mapping || {};
    const ids = Object.keys(map);
    const kidsOf = {};
    for (const id of ids) { const p = map[id].parent; if (p && map[p]) (kidsOf[p] ||= []).push(id); }
    // When the export holds the text of uploaded files as tool messages, the files are already counted there.
    const fileTextExported = ids.some(id => { const m = map[id].message; return m?.author?.role === 'tool'
      && ['file_search', 'myfiles_browser'].includes(m.author.name) && visibleText(m).trim() !== ''; });
    const info = {};
    let memorySeen = 0;
    for (const id of ids) {
      const m = map[id].message; if (!m) { info[id] = { tokens: 0, time: null, empty: true }; continue; }
      const role = m.author?.role, ct = m.content?.content_type, md = m.metadata || {};
      let tokens = tok(visibleText(m)), files = 0, images = 0, filesExact = 0;
      if (role === 'user') {
        const imgIds = new Set();
        for (const p of m.content?.parts || []) if (p?.content_type === 'image_asset_pointer') { tokens += imageTokens(p.width, p.height); images++; imgIds.add(String(p.asset_pointer || '').split('//').pop()); }
        for (const a of md.attachments || []) {
          const mime = a.mime_type ?? a.mimeType ?? '';
          if (String(mime).startsWith('image/') || imgIds.has(a.id)) continue;      // counted above
          const n = a.file_token_size ?? a.fileSizeTokens;
          if (fileTextExported) continue;                                           // the file text is a tool message in this conversation
          if (typeof n === 'number' && n >= 0) { tokens += n; filesExact++; } else files++;
        }
      }
      const isRecap = ct === 'reasoning_recap';
      const isOutput = role === 'assistant' && ct !== 'thoughts' && !isRecap && tokens > 0;
      let sources = 0;
      if (role === 'assistant') for (const g of md.search_result_groups || []) sources += (g?.entries || []).length;
      if (md.conversation_context_citation_metadata !== undefined || ct === 'model_editable_context' || (role === 'tool' && m.author?.name === 'bio')) memorySeen = 1;
      info[id] = { role, ct, tokens, isOutput, files, images, filesExact, sources, time: seconds(m.create_time),
        slug: role === 'assistant' && md.model_slug ? md.model_slug : null, resolved: role === 'assistant' && md.resolved_model_slug ? md.resolved_model_slug : null,
        recap: isRecap ? recapSeconds(m) : null, isRecap, isCustom: ct === 'user_editable_context',
        toolCall: role === 'assistant' && !!m.recipient && m.recipient !== 'all',
        legacyBrowser: role === 'tool' && m.author?.name === 'browser' && tokens > 0 };
    }
    // Depth-first order from the roots, so each node is handled after its parent. A node inside a parent loop is never reached and is ignored.
    const order = []; const stack = ids.filter(id => !map[id].parent || !map[map[id].parent]);
    const seen = new Set(stack);
    while (stack.length) { const id = stack.pop(); order.push(id); for (const k of kidsOf[id] || []) if (!seen.has(k)) { seen.add(k); stack.push(k); } }
    // cum = tokens of the node and all its ancestors. turn = the nearest user message at or above the node.
    // start = the first output node of the run of assistant output this node belongs to (thoughts and recaps do not break a run).
    // etime = the node's own time, else its nearest ancestor's, else the conversation's create_time.
    // answer = the first node of the answer the node is in: everything between two messages of the person.
    const conversationTime = seconds(c.create_time) ?? seconds(c.update_time);
    const answers = {};                            // per answer: its assistant nodes, in visiting order
    for (const id of order) {
      const x = info[id], p = map[id].parent, px = p && seen.has(p) ? info[p] : null;
      x.etime = x.time ?? (px ? px.etime : conversationTime);
      x.answer = !px || px.role === 'user' || px.empty ? id : px.answer;
      if (x.role === 'assistant') (answers[x.answer] ||= []).push(id);
      x.cum = (px ? px.cum : 0) + x.tokens;
      x.turn = x.role === 'user' ? id : (px ? px.turn : null);
      x.custom = (px?.custom ? 1 : 0) || (x.isCustom && x.tokens > 0 ? 1 : 0);
      if (x.role === 'assistant') x.start = px && px.role === 'assistant' && px.start ? px.start : (x.isOutput ? id : null);
      else x.start = null;
    }
    // Requests: one per run of output nodes. Every node is visited, so abandoned branches and regenerated answers count.
    const reqs = {}; const made = [];
    for (const id of order) {
      const me = info[id]; if (!me.isOutput) continue;
      if (me.start !== id) {                       // a later node of a run: its tokens belong to the run's request, on whichever branch it sits
        const r = reqs[me.start]; r.output += me.tokens; r.sources = Math.max(r.sources, me.sources); if (!me.toolCall) r.toolCall = false; r.nodes.push(id); continue;
      }
      // Walk up: first the new messages (fresh), then the previous answer (also read fresh), then the earlier prompt (the prefix).
      let fresh = 0, files = 0, filesExact = 0, images = 0, legacy = false, a = map[id].parent;
      for (; a && seen.has(a) && !info[a].isOutput; a = map[a].parent) {
        const x = info[a]; fresh += x.tokens; files += x.files || 0; filesExact += x.filesExact || 0; images += x.images || 0; if (x.legacyBrowser) legacy = true;
      }
      let prevOutput = 0, prefix = 0;
      if (a && seen.has(a)) {
        const s = info[a].start;                    // first output node of the previous request on this path
        const above = map[s].parent && seen.has(map[s].parent) ? info[map[s].parent].cum : 0;
        prevOutput = info[a].cum - above;           // the previous answer as it lies on this path
        prefix = above;                             // what the previous request already read as its prompt
      }
      reqs[id] = { id, nodes: [id], before: a && seen.has(a) ? info[a].start : null, slug: null, time: me.etime ?? exportTime, prefix, prevOutput, fresh, output: me.tokens,
        recapSec: 0, hasRecap: false, files, filesExact, images, legacy, sources: me.sources, custom: me.custom ? 1 : 0, toolCall: me.toolCall, turn: me.turn };
      made.push(reqs[id]);
    }
    // The model of a request, the first of these that exists: model_slug of the run's latest output node that has one; of the
    // latest assistant node of the same answer; resolved_model_slug in the same two places; the model of the nearest earlier
    // request on the path; default_model_slug, unless it is "auto". "Latest" goes by time, and of two at the same time the
    // one visited later.
    const latest = (ids, field) => {
      let best = null;
      for (const id of ids) if (info[id][field] && (best === null || (info[id].etime ?? -Infinity) >= (info[best].etime ?? -Infinity))) best = id;
      return best === null ? null : info[best][field];
    };
    const picker = c.default_model_slug && c.default_model_slug !== 'auto' ? c.default_model_slug : null;
    for (const r of made) {                        // a request is made after every request above it
      const answer = answers[info[r.id].answer] || [];
      r.slug = latest(r.nodes, 'slug') ?? latest(answer, 'slug') ?? latest(r.nodes, 'resolved') ?? latest(answer, 'resolved')
        ?? (r.before ? reqs[r.before].slug : null) ?? picker ?? 'unknown';
    }
    // Thinking times. A recap belongs to the request that follows it; if nothing follows, to the request before it in the same answer.
    const turnTimed = new Set(), turnUntimed = new Set();
    let recapsNotPlaced = 0, recapTime = null;
    for (const id of order) {
      const x = info[id]; if (!x.isRecap) continue;
      if (x.recap === null) { turnUntimed.add(x.turn); continue; }
      let target = null, cur = id;
      for (let guard = 0; guard < 10000 && !target; guard++) {     // down, along assistant nodes, to the next output node
        const kids = (kidsOf[cur] || []).filter(k => info[k].role === 'assistant'); if (!kids.length) break;
        cur = kids.find(k => info[k].isOutput) ?? kids[0];
        if (info[cur].isOutput) target = info[cur].start;
      }
      if (!target && x.start) target = x.start;                    // the recap came after the text of its answer
      if (target && reqs[target]) { reqs[target].recapSec += x.recap; reqs[target].hasRecap = true; turnTimed.add(x.turn); }
      else { recapsNotPlaced++; recapTime = x.etime ?? exportTime; }
    }
    const list = [...made].sort((a, b) => a.time - b.time);
    const timed = list.filter(r => r.hasRecap).map(r => r.recapSec).sort((a, b) => a - b);
    const medianThink = timed.length ? median(timed) : DEFAULT_THINK_SECONDS;
    if (recapsNotPlaced) each(recapTime, o => { o.counts.recapsNotPlaced += recapsNotPlaced; });
    let prev = null, memoryCounted = false;
    for (const r of list) {
      const gap = prev === null ? Infinity : r.time - prev;
      const warm = gap <= WARM_MINUTES * 60; prev = r.time;
      const cap = caps[kindOf(r.slug)];
      const prefix = Math.min(r.prefix, cap);
      const impute = !r.hasRecap && !r.toolCall && !turnTimed.has(r.turn) && (isThinkingSlug(r.slug) || turnUntimed.has(r.turn));
      if (r.time > exportTime) out.all.counts.afterWindowEnd++;
      each(r.time, o => {
        o.counts.requests++; if (!warm) o.counts.cold++; if (r.prefix > cap) o.counts.truncated++; o.counts.customInstructionsInExport += r.custom;
        o.counts.filesExact += r.filesExact; o.counts.images += r.images;
        if (memorySeen && !memoryCounted) o.counts.memorySeen++;
        o.gaps[gap <= 300 ? 'm5' : gap <= 600 ? 'm10' : gap <= 1800 ? 'm30' : gap <= 3600 ? 'm60' : 'later'] += prefix;
        add(o.rows, r.slug, 'output', r.output);
        add(o.rows, r.slug, 'freshInput', r.fresh + r.prevOutput + (warm ? 0 : prefix));
        add(o.rows, r.slug, 'cacheRead', warm ? prefix : 0);
        // piece 6: the share of the cache reads that was read fresh anyway
        if (warm) add(o.misses, r.slug, 'freshInput', prefix);
        // piece 1: thinking seconds
        if (r.hasRecap) { add(o.thinking, r.slug, 'output', r.recapSec); o.counts.thinkingTimed++; }
        else if (impute) { add(o.thinking, r.slug, 'output', medianThink); o.counts.thinkingImputed++; }
        // piece 2: hidden system prompt, one reading per request, weighted by period
        add(o.prompt, r.slug, 'cacheRead', promptWeight(r.slug, r.time));
        // piece 3: memory and custom instructions, one reading per request (the switch default decides if it is on)
        add(o.personal, r.slug, warm ? 'cacheRead' : 'freshInput', 1);
        // piece 4: web sources; piece 5: files with no token count
        const sources = r.legacy ? 0 : r.sources;
        if (sources) { add(o.search, r.slug, 'freshInput', sources); o.counts.searchAnswers++; o.counts.sources += sources; }
        if (r.files) { add(o.files, r.slug, 'freshInput', r.files); o.counts.filesEstimated += r.files; }
      });
      memoryCounted = true;
    }
  }
  return out;
}
