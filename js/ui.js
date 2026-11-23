/* The page: tabs, chat, inspector, cost strip. Plain DOM code, no framework. */
(function (g) {
  'use strict';
  var ABS = g.ABS, U = ABS.util, WS = ABS.workspaces, S = ABS.store, M = ABS.model;
  var esc = U.esc, $ = function (id) { return document.getElementById(id); };

  var TABS = [
    { n: 1, label: '1 Instructions', part: 'Context' },
    { n: 2, label: '2 Knowledge', part: 'Context' },
    { n: 3, label: '3 Memory', part: 'Memory' },
    { n: 4, label: '4 Tools & Rules', part: 'Tools + Guardrails' },
    { n: 5, label: '5 Test', part: 'Tests' }
  ];

  var state = { exampleId: 'hr', ws: null, prices: U.clone(S.DEFAULT_PRICES), tab: 1,
                chat: [], lastTurn: null, view: null, results: null,
                /* Advanced mode. on and key live only in this page's memory. */
                model: { on: false, provider: 'anthropic', baseUrl: M.PRESETS.anthropic.baseUrl, model: M.PRESETS.anthropic.model, key: '' },
                busy: false };

  /* ---------- helpers ---------- */
  function getPath(path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, state); }
  function setPath(path, val) {
    var keys = path.split('.'), last = keys.pop();
    var o = keys.reduce(function (acc, k) { return acc[k]; }, state);
    o[last] = val;
  }
  function field(path, type, attrs) {
    var v = getPath(path);
    return 'data-path="' + path + '" data-type="' + type + '"' + (attrs || '') + (type === 'bool' ? (v ? ' checked' : '') : ' value="' + esc(v) + '"');
  }
  function partTag(part) { return '<span class="tag part-' + part + '">' + part + '</span>'; }

  function persist() { S.save(state); }
  function recompute() { showScore(ABS.grader.runAll(state.ws)); }
  function showScore(r) {
    state.results = r;
    var sc = $('score');
    sc.textContent = (r.real ? 'Your model: ' : state.model.on ? 'Simulator score: ' : 'Test score: ') + r.pct + '% (' + r.passed + ' of ' + r.total + ')';
    sc.className = 'score ' + (r.total && r.passed === r.total ? 'good' : r.pct < 50 ? 'bad' : 'mid');
    updateTestRows();
  }
  function changed() { persist(); recompute(); }

  /* ---------- tabs ---------- */
  function renderTabs() {
    $('tabs').innerHTML = TABS.map(function (t) {
      var on = state.tab === t.n;
      return '<button type="button" role="tab" class="tab' + (on ? ' on' : '') + '" aria-selected="' + on + '" data-act="tab" data-n="' + t.n + '">' +
        esc(t.label) + '<small>' + esc(t.part) + '</small></button>';
    }).join('');
  }

  function panelHead(title, part, blurb) {
    return '<h2>' + esc(title) + ' ' + partTag(part) + '</h2><p class="blurb">' + blurb + '</p>';
  }

  function tabInstructions() {
    return panelHead('Instructions', 'Context', 'The system prompt is the first thing the model reads on every turn. Write who it is, who it serves, what is in and out of scope, and what to do when it is unsure.') +
      '<div class="row">' + WS.templates.map(function (t, i) {
        return '<button type="button" class="btn ghost small" data-act="template" data-i="' + i + '">Template: ' + esc(t.name) + '</button>';
      }).join('') + '</div>' +
      '<label for="instr">System prompt</label>' +
      '<textarea id="instr" rows="12" ' + field('ws.instructions', 'text') + '>' + esc(state.ws.instructions) + '</textarea>' +
      '<p class="note">The simulator reads: the word "cite", an email address (used when unsure), an <code>Allowed topics:</code> line and a <code>Forbidden topics:</code> line. A real model would understand the whole text.</p>';
  }

  function tabKnowledge() {
    var docs = state.ws.docs.map(function (d, i) {
      return '<div class="item"><div class="row"><label class="grow">Title<input type="text" ' + field('ws.docs.' + i + '.title', 'text') + '></label>' +
        '<button type="button" class="btn danger small" data-act="delDoc" data-i="' + i + '" aria-label="Delete document ' + esc(d.title) + '">Delete</button></div>' +
        '<label>Text<textarea rows="4" ' + field('ws.docs.' + i + '.text', 'text') + '>' + esc(d.text) + '</textarea></label></div>';
    }).join('') || '<p class="note">No documents yet. Without documents the assistant has no facts to answer from.</p>';
    return panelHead('Knowledge', 'Context', 'Documents the assistant may quote. Each question pulls in only the best-matching chunks, so chunk size and top-K decide what the model gets to see.') +
      '<div class="row">' +
      '<label>Chunk size (characters)<input type="number" min="40" max="2000" step="10" ' + field('ws.knowledge.chunkSize', 'num') + '></label>' +
      '<label>Chunks to show (top-K)<input type="number" min="0" max="10" step="1" ' + field('ws.knowledge.topK', 'num') + '></label></div>' +
      '<div id="lastRetrieval"></div>' +
      '<h3>Documents</h3>' + docs +
      '<button type="button" class="btn small" data-act="addDoc">Add document</button>';
  }

  function renderLastRetrieval() {
    var el = $('lastRetrieval');
    if (!el) return;
    var t = state.lastTurn;
    var total = ABS.retrieval.chunkAll(state.ws.docs, state.ws.knowledge.chunkSize).length;
    el.innerHTML = '<div class="box"><h3>Retrieved for the last question</h3>' + (t
      ? '<p class="note">Question: ' + esc(t.folder.user) + ' (' + total + ' chunks in total)</p>' + (t.folder.chunks.length
        ? t.folder.chunks.map(function (c) { return '<div class="chunk"><b>' + esc(c.label) + '</b> <span class="muted">score ' + c.score + '</span><br>' + esc(c.text) + '</div>'; }).join('')
        : '<p class="note">No chunks were retrieved for that question.</p>')
      : '<p class="note">Ask a question in the chat and the chunks used will appear here (' + total + ' chunks in total).</p>') + '</div>';
  }

  function tabMemory() {
    return panelHead('Memory', 'Memory', 'Notes about the current user that are added to the folder on every turn. Switch memory off and the notes stay saved but the model never sees them.') +
      '<label class="check"><input type="checkbox" ' + field('ws.memory.enabled', 'bool') + '> Memory is on</label>' +
      '<label for="notes">Notes about the current user (one per line)</label>' +
      '<textarea id="notes" rows="6" ' + field('ws.memory.notes', 'text') + '>' + esc(state.ws.memory.notes) + '</textarea>' +
      '<div class="row"><button type="button" class="btn danger small" data-act="forget">Forget (clear all notes)</button></div>' +
      '<p class="note">The simulator understands <code>name: Priya</code>, an order id such as ORD-9001, and the words "prefers email". Anything else is kept in the folder but not acted on.</p>';
  }

  function tabTools() {
    var t = state.ws.tools;
    var orders = t.orderData.map(function (o, i) {
      return '<tr><td><input type="text" aria-label="Order id" ' + field('ws.tools.orderData.' + i + '.id', 'text') + '></td>' +
        '<td><input type="text" aria-label="Item" ' + field('ws.tools.orderData.' + i + '.item', 'text') + '></td>' +
        '<td><input type="number" aria-label="Price" ' + field('ws.tools.orderData.' + i + '.price', 'num') + '></td>' +
        '<td><input type="number" aria-label="Days ago" ' + field('ws.tools.orderData.' + i + '.daysAgo', 'num') + '></td>' +
        '<td><button type="button" class="btn danger small" data-act="delOrder" data-i="' + i + '" aria-label="Delete order row">x</button></td></tr>';
    }).join('');
    var cat = t.catalog.map(function (p, i) {
      return '<tr><td><input type="text" aria-label="Product name" ' + field('ws.tools.catalog.' + i + '.name', 'text') + '></td>' +
        '<td><input type="number" aria-label="Price" ' + field('ws.tools.catalog.' + i + '.price', 'num') + '></td>' +
        '<td><input type="number" aria-label="Stock" ' + field('ws.tools.catalog.' + i + '.stock', 'num') + '></td>' +
        '<td><button type="button" class="btn danger small" data-act="delProduct" data-i="' + i + '" aria-label="Delete product row">x</button></td></tr>';
    }).join('');
    return panelHead('Tools & Rules', 'Tools', 'Tools let the assistant look things up instead of guessing. Rules are checked by ordinary code, outside the model, so they hold even when the model gets it wrong.') +
      '<h3>Tools ' + partTag('Tools') + '</h3>' +
      '<label class="check"><input type="checkbox" ' + field('ws.tools.orders', 'bool') + '> Order lookup (<code>order_lookup</code>)</label>' +
      '<table class="grid"><thead><tr><th>Order id</th><th>Item</th><th>Price $</th><th>Days ago</th><th></th></tr></thead><tbody>' + orders + '</tbody></table>' +
      '<button type="button" class="btn small" data-act="addOrder">Add order</button>' +
      '<label class="check"><input type="checkbox" ' + field('ws.tools.prices', 'bool') + '> Price and stock lookup (<code>price_lookup</code>)</label>' +
      '<table class="grid"><thead><tr><th>Product</th><th>Price $</th><th>Stock</th><th></th></tr></thead><tbody>' + cat + '</tbody></table>' +
      '<button type="button" class="btn small" data-act="addProduct">Add product</button>' +
      '<h3>Rules ' + partTag('Guardrails') + '</h3>' +
      '<label class="check"><input type="checkbox" ' + field('ws.rules.enforceRefund', 'bool') + '> Enforce refund rules in code (the refund guardrail)</label>' +
      '<div class="row"><label>Refund window (days)<input type="number" min="0" ' + field('ws.rules.refundDays', 'num') + '></label>' +
      '<label>Refund limit ($)<input type="number" min="0" ' + field('ws.rules.refundLimit', 'num') + '></label></div>' +
      '<label class="check"><input type="checkbox" ' + field('ws.rules.requireApproval', 'bool') + '> Require human approval above the limit (otherwise refuse)</label>' +
      '<label class="check"><input type="checkbox" ' + field('ws.rules.offTopicRefusal', 'bool') + '> Refuse off-topic questions</label>';
  }

  function tabTest() {
    var rows = state.ws.tests.map(function (t, i) {
      return '<tr data-row="' + i + '"><td><span class="pill" data-status="' + i + '">-</span></td>' +
        '<td><input type="text" aria-label="Question" ' + field('ws.tests.' + i + '.q', 'text') + '></td>' +
        '<td><input type="text" aria-label="Must include (comma separated)" ' + field('ws.tests.' + i + '.include', 'text') + '></td>' +
        '<td><input type="text" aria-label="Must not include (comma separated)" ' + field('ws.tests.' + i + '.exclude', 'text') + '></td>' +
        '<td><select aria-label="Expected tool" data-path="ws.tests.' + i + '.tool" data-type="text">' + ['', 'order_lookup', 'price_lookup'].map(function (v) {
          return '<option value="' + v + '"' + (state.ws.tests[i].tool === v ? ' selected' : '') + '>' + (v || 'none') + '</option>'; }).join('') + '</select></td>' +
        '<td class="nowrap"><button type="button" class="btn small ghost" data-act="trace" data-i="' + i + '">Trace</button> ' +
        '<button type="button" class="btn danger small" data-act="delTest" data-i="' + i + '" aria-label="Delete test ' + (i + 1) + '">x</button></td></tr>';
    }).join('');
    return panelHead('Test', 'Tests', 'A test sheet is a list of questions with the words a good answer must and must not contain. Run it after every change so you see what each change did. The score updates as you edit.') +
      '<div class="row"><button type="button" class="btn" data-act="runAll">Run all tests</button>' +
      (state.model.on ? '<button type="button" class="btn warn" data-act="runReal"' + (state.busy ? ' disabled' : '') + '>Run tests with your model</button>' : '') +
      '<span id="scoreLine" class="scoreline"></span></div>' +
      (state.model.on ? '<p class="note">"Run all tests" uses the simulator. "Run tests with your model" sends every question to ' + esc(state.model.model) +
        ', one at a time. Real replies vary from run to run, and word checks written for the simulator can fail on a reply that is fine. Read the trace before you change anything.</p>' : '') +
      '<table class="grid tests"><thead><tr><th>Result</th><th>Question</th><th>Must include</th><th>Must not include</th><th>Expected tool</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<button type="button" class="btn small" data-act="addTest">Add test</button>' +
      '<details class="box" id="hints"><summary>Hints: which part to check for each failing test</summary><div id="hintList"></div></details>' +
      '<p class="note">Click Trace on a row to see exactly what the model was handed and each step it took for that question.</p>';
  }

  function updateTestRows() {
    var r = state.results;
    if (!r) return;
    if (state.tab === 5) {
      r.items.forEach(function (it, i) {
        var el = document.querySelector('[data-status="' + i + '"]');
        if (el) { el.textContent = it.pass ? 'Pass' : 'Fail'; el.className = 'pill ' + (it.pass ? 'pass' : 'fail'); }
      });
      var sl = $('scoreLine');
      if (sl) sl.textContent = (r.real ? 'Your model (' + r.model + '): ' : 'Score: ') + r.pct + '% (' + r.passed + ' of ' + r.total + ' pass)' +
        (r.real ? '. Edit anything and the score goes back to the simulator.' : '');
      var hl = $('hintList');
      if (hl) {
        var fails = r.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (x) { return !x.it.pass; });
        hl.innerHTML = fails.length ? '<ul>' + fails.map(function (x) {
          var t = state.ws.tests[x.i];
          return '<li><b>' + esc(t.q) + '</b><br>' + esc(t.hint || 'No hint for this test. Open its trace and read which step went wrong.') +
            '<br><span class="muted">Failed checks: ' + esc(x.it.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label; }).join('; ')) + '</span></li>';
        }).join('') + '</ul><p class="note">Hints point to a part to check. They do not change anything for you.</p>' : '<p class="note">All tests pass. Nothing to check.</p>';
      }
    }
  }

  function renderPanel() {
    var html = [null, tabInstructions, tabKnowledge, tabMemory, tabTools, tabTest][state.tab]();
    $('tabpanel').innerHTML = html;
    $('tabpanel').setAttribute('aria-label', TABS[state.tab - 1].label);
    renderLastRetrieval();
    updateTestRows();
  }

  /* ---------- chat + inspector + cost ---------- */
  function renderChips() {
    $('chips').innerHTML = state.ws.tests.slice(0, 5).map(function (t, i) {
      return '<button type="button" class="chip" data-act="chip" data-i="' + i + '">' + esc(t.q) + '</button>';
    }).join('');
  }
  function renderChat() {
    $('messages').innerHTML = state.chat.length ? state.chat.map(function (m) {
      return '<div class="msg ' + m.role + '"><span class="who">' + esc(m.who || (m.role === 'user' ? 'You' : 'Simulated assistant')) + '</span>' + esc(m.text) + '</div>';
    }).join('') : '<p class="note">' + (state.model.on ? 'Ask a question. It goes to your model, ' + esc(state.model.model) + ', with the same folder the simulator would get.'
      : 'Ask a question, or click one of the examples above. Replies come from fixed rules, not a real model.') + '</p>';
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  function ask(q) {
    q = U.trim(q);
    if (!q || state.busy) return;
    if (!state.model.on) { showTurn(q, ABS.sim.respond(state.ws, q), { role: 'bot', text: '' }); return; }
    var who = 'Your model (' + U.trim(state.model.model) + ')', msg = { role: 'bot', who: who, text: 'Waiting for the reply...' };
    state.chat.push({ role: 'user', text: q }, msg);
    setBusy(true); renderChat();
    M.respond(U.clone(state.ws), q, state.model).then(function (res) {
      setBusy(false);
      state.chat.pop(); state.chat.pop();
      showTurn(q, res, { role: res.info.error ? 'err' : 'bot', who: who, text: '' });
    });
  }
  function showTurn(q, res, msg) {
    msg.text = res.reply;
    state.chat.push({ role: 'user', text: q }, msg);
    state.lastTurn = res;
    state.view = { label: 'Last answer', res: res, checks: null };
    renderChat(); renderInspector(); renderCost(); renderLastRetrieval();
  }
  function setBusy(b) {
    state.busy = b;
    $('askForm').querySelector('button').disabled = b;
    var rb = document.querySelector('[data-act=runReal]');
    if (rb) rb.disabled = b;
  }

  /* ---------- advanced: your own model ---------- */
  function renderModel() {
    var m = state.model, p = M.PRESETS[m.provider] || M.PRESETS.anthropic;
    $('byomTag').textContent = m.on ? 'on' : 'off';
    $('byomTag').className = 'sim-tag' + (m.on ? ' real-tag' : '');
    $('byomBody').innerHTML =
      '<p class="note">For readers who write code. The simulator stays the default. Switch this on to send the same folder to a real model and compare.</p>' +
      '<div class="warnbox"><b>What changes when this is on</b><ul>' +
      '<li>Each question, your instructions, the retrieved chunks, memory notes and tool results are sent to the provider below. It bills your account.</li>' +
      '<li>Your key stays in this page only. It is not saved, not exported, and is gone when you reload. Use a key with a low spending limit, and not on a shared computer.</li>' +
      '<li>Tools still run here, against the data in tab 4. The scope and refund rules are still checked in code, outside the model.</li></ul></div>' +
      '<label>Provider<select ' + field('model.provider', 'text') + '>' + Object.keys(M.PRESETS).map(function (k) {
        return '<option value="' + k + '"' + (m.provider === k ? ' selected' : '') + '>' + esc(M.PRESETS[k].label) + '</option>'; }).join('') + '</select></label>' +
      '<label>Base URL<input type="text" spellcheck="false" ' + field('model.baseUrl', 'text') + '></label>' +
      '<label>Model name<input type="text" spellcheck="false" placeholder="the model id from your provider" ' + field('model.model', 'text') + '></label>' +
      '<label>API key' + (p.needsKey ? '' : ' (often not needed for a local server)') +
      '<input type="password" autocomplete="off" spellcheck="false" ' + field('model.key', 'text') + '></label>' +
      '<label class="check"><input type="checkbox" ' + field('model.on', 'bool') + '> Send chat questions to this model</label>' +
      '<p class="note" id="byomMsg"></p>';
  }
  function updateMode() {
    var on = state.model.on, name = esc(U.trim(state.model.model));
    $('banner').className = 'banner' + (on ? ' real' : '');
    $('banner').innerHTML = on
      ? '<strong>Your own model is on (' + name + ').</strong> Questions and the folder are sent to ' + esc(U.trim(state.model.baseUrl)) +
        '. Replies can differ every time. Untick "Send chat questions to this model" to go back to the simulator.'
      : '<strong>This is a simulator, not a real AI model.</strong> It follows fixed, documented rules, so the same settings and the same question always give the same answer. That makes it a safe place to see what each part around a model does.';
    $('chatTag').textContent = on ? 'your model: ' + U.trim(state.model.model) : 'simulated model';
    $('chatTag').className = 'sim-tag' + (on ? ' real-tag' : '');
    $('byomTag').textContent = on ? 'on' : 'off';
    $('byomTag').className = 'sim-tag' + (on ? ' real-tag' : '');
    renderChat(); recompute();
    if (state.tab === 5) renderPanel();
  }
  function onModelField(path) {
    var m = state.model, msg = $('byomMsg');
    if (path === 'model.provider') {
      var p = M.PRESETS[m.provider];
      m.baseUrl = p.baseUrl; m.model = p.model; m.on = false;
      renderModel();
    }
    if (path === 'model.on' && m.on) {
      var why = M.problem(m);
      if (why) { m.on = false; document.querySelector('[data-path="model.on"]').checked = false; msg.textContent = why; return; }
    }
    if (msg) msg.textContent = '';
    if (path !== 'model.key') S.saveModel(m);
    if (m.on && M.problem(m)) { m.on = false; renderModel(); }
    updateMode();
  }
  function runReal() {
    var n = state.ws.tests.length, cfg = state.model;
    if (!n || state.busy) return;
    if (!confirm('Send all ' + n + ' test questions to ' + U.trim(cfg.model) + '? Your provider bills each one, and replies vary from run to run.')) return;
    setBusy(true);
    var ws = U.clone(state.ws);
    ABS.grader.runAllAsync(ws, function (w, q) {
      return M.respond(w, q, cfg).then(function (res) { return res.info.error ? Promise.reject(new Error(res.reply)) : res; });
    }, function (i, total) {
      var sl = $('scoreLine');
      if (sl) sl.textContent = 'Your model: running test ' + (i + 1) + ' of ' + total + '...';
    }).then(function (r) {
      setBusy(false);
      r.real = true; r.model = U.trim(cfg.model);
      showScore(r);
    }, function (e) {
      setBusy(false);
      recompute();
      var sl = $('scoreLine');
      if (sl) sl.textContent = 'Stopped. ' + e.message;
    });
  }

  function renderInspector() {
    var v = state.view, el = $('inspector');
    $('viewTitle').textContent = v ? 'Inspector: ' + v.label : 'Inspector';
    if (!v) { el.innerHTML = '<p class="note">After you ask a question, this shows what the model was handed and the steps it took.</p>'; return; }
    var f = v.res.folder;
    function sec(part, title, body) { return '<div class="sec">' + partTag(part) + ' <b>' + title + '</b><div class="body">' + body + '</div></div>'; }
    var folder =
      sec('Context', 'System prompt', '<pre>' + esc(f.system || '(empty)') + '</pre>') +
      sec('Context', 'Retrieved chunks (' + f.chunks.length + ')', f.chunks.length ? f.chunks.map(function (c) { return '<div class="chunk"><b>' + esc(c.label) + '</b> <span class="muted">score ' + c.score + '</span><br>' + esc(c.text) + '</div>'; }).join('') : '<span class="muted">none</span>') +
      sec('Memory', 'Memory notes (' + f.memory.length + ')', f.memory.length ? '<pre>' + esc(f.memory.join('\n')) + '</pre>' : '<span class="muted">none</span>') +
      sec('Tools', 'Tool results (' + f.tools.length + ')', f.tools.length ? f.tools.map(function (t) { return '<pre>' + esc(t.name + '(' + t.args + ') -> ' + t.result) + '</pre>'; }).join('') : '<span class="muted">none</span>') +
      sec('Model', 'User message', '<pre>' + esc(f.user) + '</pre>');
    var trace = '<ol class="trace">' + v.res.trace.map(function (s) { return '<li>' + partTag(s.part) + ' ' + esc(s.text) + '</li>'; }).join('') + '</ol>';
    var checks = v.checks ? '<div class="box"><b>Test checks</b><ul>' + v.checks.map(function (c) { return '<li class="' + (c.ok ? 'okc' : 'badc') + '">' + (c.ok ? 'Pass: ' : 'Fail: ') + esc(c.label) + '</li>'; }).join('') + '</ul></div>' : '';
    var sent = f.request ? '<details><summary>Exact request body sent to your model (first call, the key is not shown)</summary><pre>' +
      esc(JSON.stringify(f.request, null, 2)) + '</pre></details>' : '';
    el.innerHTML = '<div class="reply"><span class="who">' + (v.res.info && v.res.info.real ? 'Reply from your model' : 'Reply') + '</span>' + esc(v.res.reply) + '</div>' + checks +
      '<details open><summary>What the model was handed</summary>' + folder + '</details>' +
      '<details open><summary>Step by step trace</summary>' + trace + '</details>' + sent;
  }

  function renderCost() {
    var p = state.prices, t = state.lastTurn;
    var used = t && t.info && t.info.real && t.info.usage && t.info.usage.input ? t.info.usage : null;
    var inTok = used ? used.input : t ? U.estimateTokens(ABS.sim.folderText(t.folder)) : 0, outTok = used ? used.output : t ? U.estimateTokens(t.reply) : 0;
    var cost = inTok / 1e6 * U.num(p.inM, 0) + outTok / 1e6 * U.num(p.outM, 0);
    $('cost').innerHTML = '<h2>Cost estimate <span class="sim-tag">example prices</span></h2>' +
      '<div class="row"><label>Input $ per million tokens<input type="number" min="0" step="0.1" ' + field('prices.inM', 'num') + '></label>' +
      '<label>Output $ per million tokens<input type="number" min="0" step="0.1" ' + field('prices.outM', 'num') + '></label></div>' +
      (t ? '<p class="costline">Last turn: ' + (used ? '' : 'about ') + '<b>' + inTok + '</b> input tokens (' + (used ? 'reported by your provider' : 'everything in the folder') + ') and <b>' + outTok + '</b> output tokens. ' +
        'Cost per turn: <b>$' + cost.toFixed(5) + '</b>. Per 1,000 turns: <b>$' + (cost * 1000).toFixed(2) + '</b>.</p>'
        : '<p class="note">Ask a question to see an estimate.</p>') +
      '<p class="note">' + (used ? 'Token counts for the last turn were reported by your provider, across all its calls. Set the prices to your model\'s real rates.'
        : 'Tokens are estimated as characters divided by 4. Prices are examples, not a quote for any real model.') + '</p>';
  }

  /* ---------- start panel ---------- */
  function renderStart(show) {
    var el = $('start');
    el.hidden = !show;
    if (!show) return;
    el.innerHTML = '<h2>Start here</h2><ol>' +
      '<li><b>Ask something.</b> Click an example question in the chat on the right and read the reply, the folder the model was handed, and the trace.</li>' +
      '<li><b>Break it.</b> Click "Load broken version", then open tab 5 Test. The score drops because some parts are set up badly.</li>' +
      '<li><b>Fix one part at a time.</b> Use the Hints list on tab 5, change one setting, and watch the score. Repeat until it reaches 100%.</li></ol>' +
      '<button type="button" class="btn small" data-act="hideStart">Got it</button>';
  }

  /* ---------- loading workspaces ---------- */
  function loadExample(id, kind) {
    var ex = WS.examples[id];
    state.exampleId = id;
    state.ws = S.normalise(kind === 'broken' ? ex.broken() : ex.good());
    state.chat = []; state.lastTurn = null; state.view = null;
    afterLoad();
  }
  function afterLoad() {
    $('example').value = state.exampleId in WS.examples ? state.exampleId : 'hr';
    renderChips(); renderChat(); renderInspector(); renderCost(); renderPanel(); renderTabs();
    changed();
  }

  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var ACTIONS = {
    tab: function (d) { state.tab = Number(d.n); renderTabs(); renderPanel(); },
    template: function (d) { state.ws.instructions = WS.templates[Number(d.i)].text; $('instr').value = state.ws.instructions; changed(); },
    addDoc: function () { state.ws.docs.push({ title: 'New document', text: '' }); changed(); renderPanel(); },
    delDoc: function (d) { state.ws.docs.splice(Number(d.i), 1); changed(); renderPanel(); },
    addOrder: function () { state.ws.tools.orderData.push({ id: 'ORD-0000', item: '', price: 0, daysAgo: 0 }); changed(); renderPanel(); },
    delOrder: function (d) { state.ws.tools.orderData.splice(Number(d.i), 1); changed(); renderPanel(); },
    addProduct: function () { state.ws.tools.catalog.push({ name: '', price: 0, stock: 0 }); changed(); renderPanel(); },
    delProduct: function (d) { state.ws.tools.catalog.splice(Number(d.i), 1); changed(); renderPanel(); },
    forget: function () { state.ws.memory.notes = ''; changed(); renderPanel(); },
    addTest: function () { state.ws.tests.push({ q: '', include: '', exclude: '', tool: '', hint: '' }); changed(); renderPanel(); renderChips(); },
    delTest: function (d) { state.ws.tests.splice(Number(d.i), 1); changed(); renderPanel(); renderChips(); },
    runAll: function () { recompute(); renderPanel(); },
    runReal: function () { runReal(); },
    trace: function (d) {
      var i = Number(d.i), it = state.results && state.results.items[i];
      if (!it) return;
      state.view = { label: 'Test ' + (i + 1), res: it.result, checks: it.checks };
      renderInspector();
      if (g.innerWidth <= 1000) $('inspector').scrollIntoView({ block: 'nearest' });
    },
    chip: function (d) { var q = state.ws.tests[Number(d.i)].q; $('q').value = ''; ask(q); },
    loadGood: function () { loadExample(state.exampleId, 'good'); },
    loadBroken: function () { loadExample(state.exampleId, 'broken'); state.tab = 5; renderTabs(); renderPanel(); },
    export: function () { download('ai-builder-sandbox-workspace.json', S.toJSON(state)); },
    import: function () { $('importFile').click(); },
    reset: function () {
      if (!confirm('Reset everything to the working example? Your edits will be lost. Use Export JSON first to keep them.')) return;
      S.clear(); state.prices = U.clone(S.DEFAULT_PRICES); loadExample(state.exampleId, 'good');
    },
    showStart: function () { renderStart(true); g.scrollTo(0, 0); },
    hideStart: function () { S.markSeen(true); renderStart(false); }
  };

  function init() {
    $('example').innerHTML = WS.order.map(function (id) { return '<option value="' + id + '">' + esc(WS.examples[id].name) + '</option>'; }).join('');
    var saved = S.load();
    if (saved) { state.exampleId = saved.exampleId; state.ws = saved.ws; state.prices = saved.prices; afterLoad(); }
    else loadExample('hr', 'good');
    renderStart(!S.seenStart());
    var mc = S.loadModel();
    if (mc && M.PRESETS[mc.provider]) { state.model.provider = mc.provider; state.model.baseUrl = mc.baseUrl; state.model.model = mc.model; }
    renderModel();

    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act](b.dataset);
    });
    function onField(e) {
      var el = e.target;
      if (!el.dataset || !el.dataset.path) return;
      var t = el.dataset.type;
      setPath(el.dataset.path, t === 'bool' ? el.checked : t === 'num' ? U.num(el.value, 0) : el.value);
      if (el.dataset.path.indexOf('prices.') === 0) { persist(); renderCost(); return; }
      if (el.dataset.path.indexOf('model.') === 0) {
        /* Checkboxes and selects fire both events; text fields act as you type. */
        if ((e.type === 'change') === (el.type === 'checkbox' || el.tagName === 'SELECT')) onModelField(el.dataset.path);
        return;
      }
      changed();
      if (el.dataset.path.indexOf('ws.tests.') === 0 && /\.q$/.test(el.dataset.path)) renderChips();
    }
    document.addEventListener('input', onField);
    document.addEventListener('change', onField);
    $('askForm').addEventListener('submit', function (e) { e.preventDefault(); ask($('q').value); $('q').value = ''; });
    $('example').addEventListener('change', function () {
      if (!confirm('Load the working version of "' + WS.examples[$('example').value].name + '"? Your current edits will be replaced. Use Export JSON first to keep them.')) { $('example').value = state.exampleId; return; }
      loadExample($('example').value, 'good');
    });
    $('importFile').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var r = S.fromJSON(String(rd.result));
        if (!r.ok) { alert(r.error); return; }
        state.ws = r.ws; state.exampleId = r.exampleId; state.prices = r.prices; state.chat = []; state.lastTurn = null; state.view = null;
        afterLoad();
      };
      rd.readAsText(f);
      e.target.value = '';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
