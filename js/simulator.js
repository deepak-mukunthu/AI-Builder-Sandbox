/* The simulated model. It follows fixed rules, so the same workspace and question always give the same answer.
   It is NOT a real language model. It only uses facts that are in the "folder" it is handed. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util, R = ABS.retrieval;

  var OFF_TOPIC = /\b(poem|poems|joke|jokes|song|lyrics|story|recipe|weather|horoscope|movie|capital of|president|homework|essay|bitcoin|crypto)\b/i;
  var REFUND = /\b(refund|refunded|money back|reimburse)/i;
  var PRICE = /\b(price|prices|cost|costs|how much|in stock|stock|available|availability)\b/i;

  /* Read simple directives from the instructions text. */
  function parseInstructions(text) {
    text = String(text || '');
    var em = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    var fb = text.match(/^\s*forbidden topics?\s*:\s*(.+)$/im);
    var al = text.match(/^\s*allowed topics?\s*:\s*(.+)$/im);
    return {
      cite: /\bcite\b|\bcitations?\b/i.test(text),
      email: em ? em[0].replace(/[.,;]+$/, '') : '',
      forbidden: fb ? U.splitList(fb[1].replace(/\.\s*$/, '')) : [],
      allowed: al ? al[1].replace(/\.\s*$/, '').trim() : ''
    };
  }

  function parseMemory(notes) {
    notes = String(notes || '');
    var name = notes.match(/^\s*name\s*:\s*(.+)$/im);
    var ord = notes.match(/ORD-\d{4}/i);
    return {
      name: name ? name[1].trim() : '',
      order: ord ? ord[0].toUpperCase() : '',
      email: /prefers?\s+e-?mail/i.test(notes)
    };
  }

  function scopeCheck(q, dir) {
    var m = q.match(OFF_TOPIC);
    if (m) return { hit: true, why: 'the question matches the built-in off-topic list ("' + m[0].toLowerCase() + '")' };
    var qt = {};
    U.tokens(q).forEach(function (t) { qt[t] = 1; });
    for (var i = 0; i < dir.forbidden.length; i++) {
      var ft = U.tokens(dir.forbidden[i]);
      if (ft.length && ft.every(function (t) { return qt[t]; })) {
        return { hit: true, why: 'it touches a forbidden topic from the instructions ("' + dir.forbidden[i] + '")' };
      }
    }
    return { hit: false };
  }

  function bestProduct(catalog, q) {
    var qt = {}, best = null, bestScore = 0;
    U.tokens(q).forEach(function (t) { qt[t] = 1; });
    (catalog || []).forEach(function (p) {
      var s = 0;
      U.tokens(p.name).forEach(function (t) { if (qt[t]) s++; });
      if (s > bestScore) { best = p; bestScore = s; }
    });
    return best;
  }

  /* Greedy cover: pick the sentence that matches the most question words, then keep adding sentences
     only while each one matches at least 2 question words that earlier sentences did not (max 3). */
  function docAnswer(picked, qTokens) {
    var cands = [], used = [], titles = [], covered = {};
    picked.forEach(function (c) {
      R.sentences(c.text).forEach(function (s) {
        var st = {};
        U.tokens(s).forEach(function (t) { st[t] = 1; });
        cands.push({ text: s, title: c.title, st: st, used: false });
      });
    });
    var need = qTokens.length <= 2 ? 1 : 2;
    while (used.length < 3) {
      var best = null, bestGain = 0;
      cands.forEach(function (c) {
        if (c.used) return;
        var gain = qTokens.filter(function (t) { return c.st[t] && !covered[t]; }).length;
        if (gain > bestGain) { best = c; bestGain = gain; }
      });
      if (!best || bestGain < need) break;
      best.used = true;
      qTokens.forEach(function (t) { if (best.st[t]) covered[t] = 1; });
      used.push(best.text);
      if (titles.indexOf(best.title) < 0) titles.push(best.title);
      need = 2;
    }
    return { sentences: used, titles: titles };
  }

  function respond(ws, question) {
    var q = U.trim(question), trace = [], toolsCalled = [];
    var rules = ws.rules || {}, tools = ws.tools || {}, mem = ws.memory || {};
    var dir = parseInstructions(ws.instructions);
    var folder = { system: String(ws.instructions || ''), chunks: [], memory: [], tools: [], user: q };
    function step(part, text) { trace.push({ part: part, text: text }); }
    function done(reply, extra) { return { reply: reply, folder: folder, trace: trace, toolsCalled: toolsCalled, info: extra || {} }; }
    function noInfo() { return "I don't have that information." + (dir.email ? ' Please contact ' + dir.email + '.' : ''); }

    step('Context', 'Instructions loaded (' + folder.system.length + ' characters). Found: ' +
      (dir.cite ? 'cite sources; ' : 'no citation rule; ') +
      (dir.email ? 'contact ' + dir.email + '; ' : 'no contact for unsure cases; ') +
      (dir.forbidden.length ? 'forbidden topics: ' + dir.forbidden.join(', ') : 'no forbidden topics') + '.');

    /* Guardrail: scope. Runs in code, before the model sees anything. */
    var scope = scopeCheck(q, dir);
    if (scope.hit && rules.offTopicRefusal) {
      step('Guardrails', 'Blocked before the model was called: ' + scope.why + '. Off-topic refusal is ON.');
      step('Model', 'Not called. The guardrail replied for it.');
      return done('I can only help with ' + (dir.allowed || 'the topics in my instructions') + '.', { blocked: true });
    }
    if (scope.hit) {
      step('Guardrails', 'Off-topic refusal is OFF, so nothing stops this question (' + scope.why + ').');
      step('Model', 'No fact in the folder covers this. With no scope rule, the simulator answers anyway, like a model using general knowledge.');
      return done('Sure, happy to help with that! (The simulator would now answer from general knowledge, not from your documents.)', { offTopic: true });
    }
    step('Guardrails', 'Scope check passed' + (rules.offTopicRefusal ? '.' : ' (the off-topic rule is OFF, so it would not have been checked anyway).'));

    /* Knowledge */
    var ret = R.retrieve(ws.docs, q, (ws.knowledge || {}).chunkSize, (ws.knowledge || {}).topK);
    folder.chunks = ret.picked.map(function (c) { return { label: c.label, text: c.text, score: c.score }; });
    step('Context', ret.picked.length
      ? 'Retrieved ' + ret.picked.length + ' chunk(s) by keyword overlap: ' + ret.picked.map(function (c) { return c.label + ' (score ' + c.score + ')'; }).join(', ') + '.'
      : 'No chunk had enough keyword overlap with the question (need ' + ret.minScore + ' or more), so no documents were added.');

    /* Memory */
    var notes = U.trim(mem.notes), m = { name: '', order: '', email: false };
    if (mem.enabled && notes) {
      folder.memory = notes.split('\n').map(U.trim).filter(Boolean);
      m = parseMemory(notes);
      step('Memory', 'Memory is ON: ' + folder.memory.length + ' saved note(s) added to the folder.');
    } else if (notes) {
      step('Memory', 'Memory is OFF: ' + notes.split('\n').filter(U.trim).length + ' saved note(s) exist but were NOT given to the model.');
    } else {
      step('Memory', 'No memory notes.');
    }

    /* Tools, chosen by simple intent rules */
    var idm = q.match(/ORD-\d{4}/i), orderId = idm ? idm[0].toUpperCase() : '';
    var refund = REFUND.test(q);
    if (refund && !orderId && m.order) { orderId = m.order; step('Memory', 'The question has no order id, so the model uses the saved note: ' + m.order + '.'); }
    var order = null, orderWanted = !!orderId, orderOff = false, orderMissing = false;
    if (orderWanted) {
      if (tools.orders) {
        toolsCalled.push('order_lookup');
        order = (tools.orderData || []).filter(function (o) { return String(o.id).toUpperCase() === orderId; })[0] || null;
        folder.tools.push({ name: 'order_lookup', args: orderId, result: order ? JSON.stringify(order) : 'not found' });
        orderMissing = !order;
        step('Tools', 'Intent: order id ' + orderId + '. Called order_lookup: ' + (order ? 'found.' : 'no such order.'));
      } else { orderOff = true; step('Tools', 'Intent: order id ' + orderId + ', but the order lookup tool is OFF, so it was not called.'); }
    }
    var product = null, priceWanted = PRICE.test(q) && !!bestProduct(tools.catalog, q), priceOff = false;
    if (priceWanted) {
      if (tools.prices) {
        toolsCalled.push('price_lookup');
        product = bestProduct(tools.catalog, q);
        folder.tools.push({ name: 'price_lookup', args: product.name, result: JSON.stringify(product) });
        step('Tools', 'Intent: price or stock of "' + product.name + '". Called price_lookup.');
      } else { priceOff = true; step('Tools', 'Intent: price or stock, but the price/stock tool is OFF, so it was not called.'); }
    }
    if (!orderWanted && !priceWanted) step('Tools', 'No tool intent found (no order id, no price or stock question).');

    /* Model: choose an answer from the folder only */
    var reply = '', kind = '';
    if (refund && order) {
      kind = 'refund';
      step('Model', 'Proposes: approve a refund of ' + U.money(order.price, 0) + ' for ' + order.id + '.');
      var days = U.num(order.daysAgo, 0), price = U.num(order.price, 0);
      var win = U.num(rules.refundDays, 30), lim = U.num(rules.refundLimit, 150);
      var ok = 'Refund approved: ' + U.money(price, 0) + ' for ' + order.id + ' (' + order.item + ').';
      if (!rules.enforceRefund) {
        step('Guardrails', 'Refund rules are OFF, so the proposal goes straight through. Nothing checks the ' + win + '-day window or the ' + U.money(lim, 0) + ' limit.');
        reply = ok;
      } else if (days > win) {
        step('Guardrails', 'Checked window: ' + days + ' days old vs ' + win + ' allowed. Refused in code.');
        reply = "I can't refund " + order.id + '. It was placed ' + days + ' days ago and the refund window is ' + win + ' days.';
      } else if (price > lim && rules.requireApproval) {
        step('Guardrails', 'Checked limit: ' + U.money(price, 0) + ' is above ' + U.money(lim, 0) + '. "Require human approval" is ON, so the refund is drafted for a person.');
        reply = order.id + ' is ' + U.money(price, 0) + ', above the ' + U.money(lim, 0) + ' limit I can refund on my own. I have sent the request to a human for approval.';
      } else if (price > lim) {
        step('Guardrails', 'Checked limit: ' + U.money(price, 0) + ' is above ' + U.money(lim, 0) + '. Refused in code.');
        reply = "I can't refund " + order.id + '. ' + U.money(price, 0) + ' is above the ' + U.money(lim, 0) + ' refund limit.';
      } else {
        step('Guardrails', 'Checked window (' + days + ' of ' + win + ' days) and limit (' + U.money(price, 0) + ' of ' + U.money(lim, 0) + '). Both pass.');
        reply = ok;
      }
      if (m.email && /approved|approval/.test(reply)) reply += " I'll send the confirmation by email.";
    } else if (refund && !orderId) {
      kind = 'ask';
      step('Model', 'A refund needs an order id and the folder has none (no id in the question, no saved note). It asks instead of guessing.');
      reply = 'Which order would you like refunded? Please send the order id, like ORD-1234.';
    } else if (orderMissing) {
      kind = 'missing';
      step('Model', 'The order lookup found nothing, so there is nothing to report.');
      reply = "I can't find an order with id " + orderId + '.';
    } else if (order) {
      kind = 'order';
      step('Model', 'Reports the order lookup result.');
      reply = 'Order ' + order.id + ': ' + order.item + ', ' + U.money(order.price, 0) + ', placed ' + order.daysAgo + ' days ago.';
    } else if (product) {
      kind = 'price';
      var st = U.num(product.stock, 0);
      step('Model', 'Reports the price/stock lookup result.');
      reply = product.name + ': ' + U.money(product.price, 0) + ', ' + (st > 0 ? 'in stock (' + st + ' available).' : 'currently out of stock.');
    } else {
      var ans = docAnswer(ret.picked, ret.queryTokens);
      if (ans.sentences.length) {
        kind = 'docs';
        step('Model', 'Answers with the best-matching sentence from each retrieved chunk' + (dir.cite ? ', and cites the document titles because the instructions say to.' : '. The instructions do not ask for citations.'));
        reply = ans.sentences.join(' ') + (dir.cite ? ' (Source: ' + ans.titles.join('; ') + ')' : '');
      } else {
        kind = 'unsure';
        step('Model', 'Nothing in the folder answers this. It says so instead of inventing an answer' + (dir.email ? ', and gives the contact from the instructions.' : '. The instructions give no contact to hand off to.'));
        reply = noInfo();
      }
    }
    if (m.name) {
      reply = 'Hi ' + m.name + '! ' + reply;
      step('Memory', 'Added a greeting from the saved note (name: ' + m.name + ').');
    }
    return done(reply, { kind: kind });
  }

  function folderText(f) {
    return [f.system, f.chunks.map(function (c) { return c.text; }).join('\n'), f.memory.join('\n'),
      f.tools.map(function (t) { return t.name + ' ' + t.args + ' ' + t.result; }).join('\n'), f.user].join('\n');
  }

  ABS.sim = { respond: respond, folderText: folderText, parseInstructions: parseInstructions, scopeCheck: scopeCheck };
})(typeof window !== 'undefined' ? window : globalThis);
