/* Optional, for advanced users: send the same folder to a real model with your own API key.
   Off by default. The simulator never calls this file. Tools run here in the browser against the
   tab 4 data, and the scope and refund guardrails are still checked in code, outside the model. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util, R = ABS.retrieval;

  var MAX_CALLS = 4;   // model calls per question, so a tool loop cannot run away
  var PRESETS = {
    anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', needsKey: true },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', needsKey: true },
    local: { label: 'OpenAI-compatible (Ollama, LM Studio, OpenRouter...)', baseUrl: 'http://localhost:11434/v1', model: '', needsKey: false }
  };

  function wire(cfg) { return cfg.provider === 'anthropic' ? 'anthropic' : 'openai'; }

  /* Returns '' if the settings can be used, or a sentence saying what is missing. */
  function problem(cfg) {
    cfg = cfg || {};
    var p = PRESETS[cfg.provider];
    if (!p) return 'Pick a provider.';
    if (!U.trim(cfg.baseUrl)) return 'Enter a base URL.';
    if (!U.trim(cfg.model)) return 'Enter a model name.';
    if (p.needsKey && !U.trim(cfg.key)) return 'Enter your API key.';
    return '';
  }

  /* The tools the model may call: only the ones switched on in tab 4. */
  function toolDefs(ws) {
    var t = ws.tools || {}, out = [];
    if (t.orders) {
      out.push({ name: 'order_lookup', description: 'Look up one order by its id, like ORD-1234. Returns the item, price and how many days ago it was placed.',
        params: { order_id: 'The order id, like ORD-1234' } });
      out.push({ name: 'request_refund', description: 'Ask to refund an order. Store code looks up the order, checks the refund rules and returns the decision. This is the only way to issue a refund.',
        params: { order_id: 'The order id, like ORD-1234' } });
    }
    if (t.prices) {
      out.push({ name: 'price_lookup', description: 'Look up the current price and stock of one product by name.',
        params: { product: 'The product name' } });
    }
    return out;
  }
  function schema(params) {
    var props = {};
    Object.keys(params).forEach(function (k) { props[k] = { type: 'string', description: params[k] }; });
    return { type: 'object', properties: props, required: Object.keys(params) };
  }

  /* The folder, written out as the system prompt the model receives. */
  function systemText(folder) {
    var s = folder.system;
    if (folder.chunks.length) s += '\n\n## Documents retrieved for this question\n' + folder.chunks.map(function (c) { return '[' + c.label + '] ' + c.text; }).join('\n');
    if (folder.memory.length) s += '\n\n## Saved notes about this customer\n' + folder.memory.join('\n');
    return s;
  }

  /* Build one HTTP request. Pure, so it can be tested without a network. */
  function buildRequest(cfg, system, messages, tools) {
    var base = U.trim(cfg.baseUrl).replace(/\/+$/, ''), body, headers = { 'content-type': 'application/json' };
    if (wire(cfg) === 'anthropic') {
      headers['x-api-key'] = U.trim(cfg.key);
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';   // allows a call straight from a web page
      body = { model: U.trim(cfg.model), max_tokens: 600, system: system, messages: messages };
      if (tools.length) body.tools = tools.map(function (t) { return { name: t.name, description: t.description, input_schema: schema(t.params) }; });
      return { url: base + '/messages', headers: headers, body: body };
    }
    if (U.trim(cfg.key)) headers.authorization = 'Bearer ' + U.trim(cfg.key);
    body = { model: U.trim(cfg.model), messages: [{ role: 'system', content: system }].concat(messages) };
    if (tools.length) body.tools = tools.map(function (t) { return { type: 'function', function: { name: t.name, description: t.description, parameters: schema(t.params) } }; });
    return { url: base + '/chat/completions', headers: headers, body: body };
  }

  /* Read a provider reply into { text, calls: [{ id, name, args }], usage: { input, output } }. */
  function parseResponse(cfg, data) {
    data = data || {};
    if (wire(cfg) === 'anthropic') {
      var blocks = data.content || [];
      return {
        text: blocks.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim(),
        calls: blocks.filter(function (b) { return b.type === 'tool_use'; }).map(function (b) { return { id: b.id, name: b.name, args: b.input || {} }; }),
        usage: { input: U.num(data.usage && data.usage.input_tokens, 0), output: U.num(data.usage && data.usage.output_tokens, 0) }
      };
    }
    var msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    return {
      text: U.trim(msg.content),
      calls: (msg.tool_calls || []).map(function (c) {
        var args = {};
        try { args = JSON.parse((c['function'] && c['function'].arguments) || '{}') || {}; } catch (e) { args = {}; }
        return { id: c.id, name: c['function'] && c['function'].name, args: args };
      }),
      usage: { input: U.num(data.usage && data.usage.prompt_tokens, 0), output: U.num(data.usage && data.usage.completion_tokens, 0) }
    };
  }

  /* Add the model's turn and our tool results to the conversation, in each provider's format. */
  function addToolResults(cfg, messages, data, results) {
    if (wire(cfg) === 'anthropic') {
      messages.push({ role: 'assistant', content: data.content });
      messages.push({ role: 'user', content: results.map(function (r) { return { type: 'tool_result', tool_use_id: r.id, content: r.result }; }) });
    } else {
      messages.push(data.choices[0].message);
      results.forEach(function (r) { messages.push({ role: 'tool', tool_call_id: r.id, content: r.result }); });
    }
  }

  function findProduct(catalog, name) {
    var want = U.trim(name).toLowerCase(), wt = {}, best = null, bestScore = 0;
    var exact = (catalog || []).filter(function (p) { return p.name.toLowerCase() === want; })[0];
    if (exact) return exact;
    U.tokens(name).forEach(function (t) { wt[t] = 1; });
    (catalog || []).forEach(function (p) {
      var s = U.tokens(p.name).filter(function (t) { return wt[t]; }).length;
      if (s > bestScore) { best = p; bestScore = s; }
    });
    return best;
  }

  /* Run one tool call locally. The refund rules are checked here, in code, the same way the simulator checks them. */
  function runTool(ws, call, step) {
    var tools = ws.tools || {}, rules = ws.rules || {}, a = call.args || {};
    var id = U.trim(a.order_id).toUpperCase();
    var order = function () { return (tools.orderData || []).filter(function (o) { return String(o.id).toUpperCase() === id; })[0] || null; };
    if (call.name === 'order_lookup' && tools.orders) {
      var o = order();
      step('Tools', 'Your model called order_lookup("' + id + '"): ' + (o ? 'found.' : 'no such order.'));
      return o ? JSON.stringify(o) : 'not found';
    }
    if (call.name === 'price_lookup' && tools.prices) {
      var p = findProduct(tools.catalog, a.product);
      step('Tools', 'Your model called price_lookup("' + U.trim(a.product) + '"): ' + (p ? 'matched ' + p.name + '.' : 'no such product.'));
      return p ? JSON.stringify(p) : 'not found';
    }
    if (call.name === 'request_refund' && tools.orders) {
      var r = order();
      step('Tools', 'Your model called request_refund("' + id + '"). The tool reads the order record itself, which counts as an order lookup: ' + (r ? 'found.' : 'no such order.'));
      if (!r) { step('Guardrails', 'No such order, so there is nothing to refund.'); return JSON.stringify({ decision: 'refused', reason: 'no order with that id' }); }
      var days = U.num(r.daysAgo, 0), price = U.num(r.price, 0), win = U.num(rules.refundDays, 30), lim = U.num(rules.refundLimit, 150);
      var res;
      if (!rules.enforceRefund) {
        step('Guardrails', 'Refund rules are OFF, so the request goes straight through. Nothing checks the ' + win + '-day window or the ' + U.money(lim, 0) + ' limit.');
        res = { decision: 'approved', amount: price };
      } else if (days > win) {
        step('Guardrails', 'Checked window: ' + days + ' days old vs ' + win + ' allowed. Refused in code.');
        res = { decision: 'refused', reason: 'placed ' + days + ' days ago; the refund window is ' + win + ' days' };
      } else if (price > lim && rules.requireApproval) {
        step('Guardrails', 'Checked limit: ' + U.money(price, 0) + ' is above ' + U.money(lim, 0) + '. Sent to a human for approval.');
        res = { decision: 'sent_to_human', reason: U.money(price, 0) + ' is above the ' + U.money(lim, 0) + ' limit; a person must approve it' };
      } else if (price > lim) {
        step('Guardrails', 'Checked limit: ' + U.money(price, 0) + ' is above ' + U.money(lim, 0) + '. Refused in code.');
        res = { decision: 'refused', reason: U.money(price, 0) + ' is above the ' + U.money(lim, 0) + ' refund limit' };
      } else {
        step('Guardrails', 'Checked window (' + days + ' of ' + win + ' days) and limit (' + U.money(price, 0) + ' of ' + U.money(lim, 0) + '). Both pass.');
        res = { decision: 'approved', amount: price };
      }
      return JSON.stringify(res);
    }
    step('Tools', 'Your model asked for "' + call.name + '", which is not switched on. Nothing was run.');
    return 'error: tool not available';
  }

  function post(req, fetchFn) {
    return fetchFn(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) }).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = JSON.parse(txt); } catch (e) { data = null; }
        if (!r.ok) {
          var msg = data && data.error && (data.error.message || data.error) || txt.slice(0, 200);
          throw new Error('The provider returned ' + r.status + ': ' + msg);
        }
        if (!data) throw new Error('The provider sent a reply that is not JSON.');
        return data;
      });
    }, function () {
      throw new Error('Could not reach ' + req.url + '. Check the base URL and your connection. A local server must allow requests from web pages (for Ollama, set OLLAMA_ORIGINS).');
    });
  }

  /* Same job and same result shape as ABS.sim.respond, but the Model step is a real model. Returns a Promise. */
  function respond(ws, question, cfg, fetchFn) {
    var q = U.trim(question), trace = [], toolsCalled = [], usage = { input: 0, output: 0 };
    var rules = ws.rules || {}, mem = ws.memory || {};
    var dir = ABS.sim.parseInstructions(ws.instructions);
    var folder = { system: String(ws.instructions || ''), chunks: [], memory: [], tools: [], user: q, request: null };
    function step(part, text) { trace.push({ part: part, text: text }); }
    function done(reply, extra) {
      var info = extra || {};
      info.real = true; info.model = U.trim(cfg.model); info.usage = usage;
      return { reply: reply, folder: folder, trace: trace, toolsCalled: toolsCalled, info: info };
    }
    fetchFn = fetchFn || (g.fetch && g.fetch.bind(g));

    step('Context', 'Instructions loaded (' + folder.system.length + ' characters). Your model reads all of it, not just the keywords the simulator looks for.');
    var scope = ABS.sim.scopeCheck(q, dir);
    if (scope.hit && rules.offTopicRefusal) {
      step('Guardrails', 'Blocked before the model was called: ' + scope.why + '. Off-topic refusal is ON. Nothing was sent.');
      step('Model', 'Not called. The guardrail replied for it.');
      return Promise.resolve(done('I can only help with ' + (dir.allowed || 'the topics in my instructions') + '.', { blocked: true }));
    }
    step('Guardrails', scope.hit ? 'Off-topic refusal is OFF, so nothing stops this question (' + scope.why + '). It goes to your model.' : 'Scope check passed.');

    var ret = R.retrieve(ws.docs, q, (ws.knowledge || {}).chunkSize, (ws.knowledge || {}).topK);
    folder.chunks = ret.picked.map(function (c) { return { label: c.label, text: c.text, score: c.score }; });
    step('Context', ret.picked.length
      ? 'Retrieved ' + ret.picked.length + ' chunk(s) by keyword overlap: ' + ret.picked.map(function (c) { return c.label + ' (score ' + c.score + ')'; }).join(', ') + '.'
      : 'No chunk had enough keyword overlap with the question, so no documents were added.');

    var notes = U.trim(mem.notes);
    if (mem.enabled && notes) {
      folder.memory = notes.split('\n').map(U.trim).filter(Boolean);
      step('Memory', 'Memory is ON: ' + folder.memory.length + ' saved note(s) added to the folder.');
    } else step('Memory', notes ? 'Memory is OFF: the saved notes were NOT sent.' : 'No memory notes.');

    var tools = toolDefs(ws), system = systemText(folder), messages = [{ role: 'user', content: q }];
    step('Tools', tools.length ? 'Offered tools: ' + tools.map(function (t) { return t.name; }).join(', ') + '. Your model decides whether to call them.' : 'No tools are switched on, so none were offered.');

    function turn(n) {
      var req = buildRequest(cfg, system, messages, tools);
      if (!folder.request) folder.request = req.body;
      return post(req, fetchFn).then(function (data) {
        var r = parseResponse(cfg, data);
        usage.input += r.usage.input; usage.output += r.usage.output;
        if (!r.calls.length || n >= MAX_CALLS) {
          step('Model', 'Your model (' + U.trim(cfg.model) + ') wrote the reply' + (r.calls.length ? ', still asking for tools after ' + MAX_CALLS + ' calls, so the sandbox stopped it' : '') +
            '. Tokens reported by the provider: ' + usage.input + ' in, ' + usage.output + ' out.');
          return done(r.text || '(The model returned no text.)');
        }
        step('Model', 'Your model asked for ' + r.calls.length + ' tool call(s).');
        var results = r.calls.map(function (c) {
          var out = runTool(ws, c, step);
          if (out !== 'error: tool not available') {
            (c.name === 'request_refund' ? ['order_lookup', c.name] : [c.name]).forEach(function (n) { if (toolsCalled.indexOf(n) < 0) toolsCalled.push(n); });
          }
          folder.tools.push({ name: c.name, args: JSON.stringify(c.args), result: out });
          return { id: c.id, result: out };
        });
        addToolResults(cfg, messages, data, results);
        return turn(n + 1);
      });
    }
    return turn(1).catch(function (e) {
      step('Model', 'The call failed: ' + e.message);
      return done('Error: ' + e.message, { error: true });
    });
  }

  ABS.model = { PRESETS: PRESETS, problem: problem, toolDefs: toolDefs, systemText: systemText, buildRequest: buildRequest,
                parseResponse: parseResponse, runTool: runTool, respond: respond };
})(typeof window !== 'undefined' ? window : globalThis);
