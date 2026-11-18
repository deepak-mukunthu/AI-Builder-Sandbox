/* Saving: auto-save to localStorage, export/import the whole workspace as a JSON file. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util;
  var KEY = 'ai-builder-sandbox.v1';
  var SEEN = 'ai-builder-sandbox.seen-start';

  var DEFAULT_PRICES = { inM: 3, outM: 15 };

  /* Fill in anything missing so older or hand-edited files still load. */
  function normalise(w) {
    w = w && typeof w === 'object' ? w : {};
    var out = {
      name: typeof w.name === 'string' && w.name ? w.name : 'My workspace',
      instructions: typeof w.instructions === 'string' ? w.instructions : '',
      docs: Array.isArray(w.docs) ? w.docs.map(function (d) { return { title: String(d && d.title || ''), text: String(d && d.text || '') }; }) : [],
      knowledge: { chunkSize: U.num(w.knowledge && w.knowledge.chunkSize, 300), topK: U.num(w.knowledge && w.knowledge.topK, 3) },
      memory: { enabled: !!(w.memory && w.memory.enabled), notes: String(w.memory && w.memory.notes || '') },
      tools: {
        orders: !!(w.tools && w.tools.orders), prices: !!(w.tools && w.tools.prices),
        orderData: Array.isArray(w.tools && w.tools.orderData) ? w.tools.orderData.map(function (o) {
          return { id: String(o.id || ''), item: String(o.item || ''), price: U.num(o.price, 0), daysAgo: U.num(o.daysAgo, 0) }; }) : [],
        catalog: Array.isArray(w.tools && w.tools.catalog) ? w.tools.catalog.map(function (p) {
          return { name: String(p.name || ''), price: U.num(p.price, 0), stock: U.num(p.stock, 0) }; }) : []
      },
      rules: {
        enforceRefund: !(w.rules && w.rules.enforceRefund === false), refundDays: U.num(w.rules && w.rules.refundDays, 30),
        refundLimit: U.num(w.rules && w.rules.refundLimit, 150), requireApproval: !(w.rules && w.rules.requireApproval === false),
        offTopicRefusal: !!(w.rules && w.rules.offTopicRefusal)
      },
      tests: Array.isArray(w.tests) ? w.tests.map(function (t) {
        return { q: String(t.q || ''), include: String(t.include || ''), exclude: String(t.exclude || ''), tool: String(t.tool || ''), hint: String(t.hint || '') }; }) : []
    };
    return out;
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify({ exampleId: state.exampleId, ws: state.ws, prices: state.prices })); return true; }
    catch (e) { return false; }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return { exampleId: o.exampleId || 'hr', ws: normalise(o.ws), prices: { inM: U.num(o.prices && o.prices.inM, 3), outM: U.num(o.prices && o.prices.outM, 15) } };
    } catch (e) { return null; }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  function seenStart() { try { return localStorage.getItem(SEEN) === '1'; } catch (e) { return false; } }
  function markSeen(v) { try { localStorage.setItem(SEEN, v ? '1' : '0'); } catch (e) { /* ignore */ } }

  function toJSON(state) {
    return JSON.stringify({ app: 'ai-builder-sandbox', version: 1, exampleId: state.exampleId, prices: state.prices, workspace: state.ws }, null, 2);
  }
  /* Returns { ok, ws, prices, exampleId } or { ok: false, error }. */
  function fromJSON(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!o || o.app !== 'ai-builder-sandbox' || !o.workspace) return { ok: false, error: 'That file is not an AI Builder Sandbox export.' };
    return { ok: true, ws: normalise(o.workspace), exampleId: o.exampleId || 'hr',
             prices: { inM: U.num(o.prices && o.prices.inM, 3), outM: U.num(o.prices && o.prices.outM, 15) } };
  }

  ABS.store = { normalise: normalise, save: save, load: load, clear: clear, seenStart: seenStart, markSeen: markSeen,
                toJSON: toJSON, fromJSON: fromJSON, DEFAULT_PRICES: DEFAULT_PRICES };
})(typeof window !== 'undefined' ? window : globalThis);
