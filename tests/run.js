/* Run with: node tests/run.js
   Loads the browser scripts into a vm context (no DOM needed) and checks the teaching examples. */
'use strict';
var vm = require('vm'), fs = require('fs'), path = require('path');
var JS = path.join(__dirname, '..', 'js');
var FILES = ['util', 'retrieval', 'simulator', 'model', 'grader', 'workspaces', 'store'];

function load() {
  var ctx = vm.createContext({ console: console });   // minimal stub: no window, no localStorage
  FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(JS, f + '.js'), 'utf8'), ctx, { filename: f + '.js' }); });
  return ctx.ABS;
}

var failures = 0, count = 0;
function check(name, cond, extra) {
  count++;
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

var EXPECTED = {
  hr:   [25, 62.5, 75, 87.5, 100],
  shop: [30, 40, 50, 70, 90, 100]
};

var ABS = load();
Object.keys(EXPECTED).forEach(function (id) {
  console.log('\nWorkspace: ' + id);
  var ex = ABS.workspaces.examples[id];
  var good = ABS.grader.runAll(ex.good());
  check('working version scores 100%', good.pct === 100, 'got ' + good.pct);
  var path_ = ABS.workspaces.fixPath(id), scores = path_.map(function (s) { return s.score.pct; });
  console.log('  scores: ' + scores.join(' -> '));
  path_.forEach(function (s, i) { console.log('    ' + s.score.pct + '%  ' + s.label); });
  check('broken start is below 50%', scores[0] < 50, 'got ' + scores[0]);
  for (var i = 1; i < scores.length; i++) check('fix ' + i + ' raises the score (' + scores[i - 1] + ' -> ' + scores[i] + ')', scores[i] > scores[i - 1]);
  check('final score is 100%', scores[scores.length - 1] === 100);
  check('scores match the documented path', JSON.stringify(scores) === JSON.stringify(EXPECTED[id]), JSON.stringify(scores));
  check('every test has a hint', ex.good().tests.every(function (t) { return t.hint; }));
});

console.log('\nDeterminism');
var A = load(), B = load();
Object.keys(EXPECTED).forEach(function (id) {
  [function (a) { return a.workspaces.examples[id].good(); }, function (a) { return a.workspaces.examples[id].broken(); }].forEach(function (mk, k) {
    var a = JSON.stringify(A.grader.runAll(mk(A))), b = JSON.stringify(B.grader.runAll(mk(B)));
    var again = JSON.stringify(A.grader.runAll(mk(A)));
    check(id + (k ? ' broken' : ' working') + ': identical results in two separate loads and on a repeat run', a === b && a === again);
  });
});

console.log('\nSimulator behavior');
var shop = ABS.workspaces.examples.shop.good(), hr = ABS.workspaces.examples.hr.good();
var r = ABS.sim.respond(hr, 'Do we offer dental coverage?');
check('says it does not have information, never invents', /don't have that information/.test(r.reply) && r.folder.chunks.length === 0);
check('refund over the window is refused by the guardrail', /can't refund/.test(ABS.sim.respond(shop, 'refund ORD-9003').reply));
check('refund over the limit goes to a human', /human for approval/.test(ABS.sim.respond(shop, 'refund ORD-9004').reply));
shop.rules.enforceRefund = false;
check('with the guardrail off, the model approves the $400 refund', /Refund approved: \$400/.test(ABS.sim.respond(shop, 'refund ORD-9004').reply));
shop = ABS.workspaces.examples.shop.good(); shop.memory.enabled = false;
check('memory off: model asks for the order id', /Which order/.test(ABS.sim.respond(shop, 'refund my last order').reply));
shop.memory.enabled = true;
check('memory on: model uses the saved order id', /ORD-9001/.test(ABS.sim.respond(shop, 'refund my last order').reply));
check('trace steps carry a part tag', ABS.sim.respond(hr, 'How often are laptops replaced?').trace.every(function (s) { return /^(Context|Memory|Tools|Guardrails|Model)$/.test(s.part); }));

console.log('\nToken counter');
var U = ABS.util, weird = [undefined, null, NaN, '', 'a', 'x'.repeat(1001), 'ORD-9001 refund', '???', '\n'];
check('estimateTokens never returns NaN', weird.every(function (v) { return isFinite(U.estimateTokens(v)); }));
check('estimateTokens is characters / 4 rounded up', U.estimateTokens('x'.repeat(1001)) === 251 && U.estimateTokens('') === 0);
var qs = ['', '   ', 'refund', 'ORD-9999 refund', 'price of unicorn', 'poem', 'How often are laptops replaced?'];
var allFinite = true;
[ABS.workspaces.examples.hr.good(), ABS.workspaces.examples.shop.broken()].forEach(function (w) {
  qs.forEach(function (q) {
    var t = ABS.sim.respond(w, q), inT = U.estimateTokens(ABS.sim.folderText(t.folder)), outT = U.estimateTokens(t.reply);
    var cost = inT / 1e6 * U.num('abc', 3) + outT / 1e6 * U.num(undefined, 15);
    if (!isFinite(inT) || !isFinite(outT) || !isFinite(cost)) allFinite = false;
  });
});
check('tokens and cost are finite for odd questions and bad price input', allFinite);

console.log('\nExport / import');
var st = { exampleId: 'shop', ws: ABS.workspaces.examples.shop.broken(), prices: { inM: 3, outM: 15 } };
var back = ABS.store.fromJSON(ABS.store.toJSON(st));
check('round trip keeps the workspace', back.ok && JSON.stringify(back.ws) === JSON.stringify(ABS.store.normalise(st.ws)));
check('bad files are rejected', !ABS.store.fromJSON('not json').ok && !ABS.store.fromJSON('{"a":1}').ok);
check('normalise tolerates an empty object', ABS.grader.runAll(ABS.store.normalise({})).total === 0);

console.log('\nYour own model (advanced, no network: a fake fetch stands in for the provider)');
var M = ABS.model, cfgA = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1/', model: 'm1', key: 'not-a-real-key' };
var cfgO = { provider: 'local', baseUrl: 'http://localhost:11434/v1', model: 'm2', key: '' };
check('settings check names what is missing', M.problem({ provider: 'openai', baseUrl: 'x', model: 'y', key: '' }) === 'Enter your API key.' && M.problem(cfgO) === '');
var tools = M.toolDefs(ABS.workspaces.examples.shop.good());
var rqA = M.buildRequest(cfgA, 'SYS', [{ role: 'user', content: 'hi' }], tools);
check('Anthropic request: url, browser header, system and tools', rqA.url === 'https://api.anthropic.com/v1/messages' && rqA.headers['x-api-key'] === 'not-a-real-key' &&
  rqA.headers['anthropic-dangerous-direct-browser-access'] === 'true' && rqA.body.system === 'SYS' && rqA.body.tools.length === 3 && rqA.body.tools[0].input_schema.required[0] === 'order_id');
var rqO = M.buildRequest(cfgO, 'SYS', [{ role: 'user', content: 'hi' }], []);
check('OpenAI-style request: system first, no tools field when none are on, no auth header without a key',
  rqO.url === 'http://localhost:11434/v1/chat/completions' && rqO.body.messages[0].role === 'system' && !('tools' in rqO.body) && !rqO.headers.authorization);
check('the key is never in the request body', JSON.stringify(rqA.body).indexOf('not-a-real-key') < 0);
check('tools that are off are not offered', M.toolDefs(ABS.workspaces.examples.shop.broken()).map(function (t) { return t.name; }).indexOf('price_lookup') < 0);
var pO = M.parseResponse(cfgO, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', 'function': { name: 'order_lookup', arguments: '{"order_id":"ORD-9001"}' } }] } }] });
check('OpenAI tool calls are parsed', pO.calls.length === 1 && pO.calls[0].args.order_id === 'ORD-9001' && pO.text === '');
var steps = [], st = function (p, t) { steps.push(p); };
var wsR = ABS.workspaces.examples.shop.good();
check('refund guardrail still runs in code: past the window is refused', JSON.parse(M.runTool(wsR, { name: 'request_refund', args: { order_id: 'ORD-9003' } }, st)).decision === 'refused');
check('refund guardrail still runs in code: over the limit goes to a human', JSON.parse(M.runTool(wsR, { name: 'request_refund', args: { order_id: 'ORD-9004' } }, st)).decision === 'sent_to_human');
check('a tool that is off is not run', M.runTool(ABS.workspaces.examples.shop.broken(), { name: 'price_lookup', args: { product: 'x' } }, st).indexOf('not available') >= 0);

/* A fake Anthropic server: first asks for order_lookup, then answers. Records every request. */
function fakeFetch(log) {
  return function (url, init) {
    var body = JSON.parse(init.body); log.push(body);
    var data = body.messages.length === 1
      ? { content: [{ type: 'tool_use', id: 't1', name: 'order_lookup', input: { order_id: 'ORD-9001' } }], usage: { input_tokens: 100, output_tokens: 10 } }
      : { content: [{ type: 'text', text: 'Your order ORD-9001 is on its way.' }], usage: { input_tokens: 150, output_tokens: 12 } };
    return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(data)); } });
  };
}
var log = [], calls = 0;
var pending = M.respond(wsR, 'Where is ORD-9001?', cfgA, fakeFetch(log)).then(function (res) {
  check('real loop: tool runs locally and the reply comes back', res.reply === 'Your order ORD-9001 is on its way.' && res.toolsCalled[0] === 'order_lookup' && res.folder.tools.length === 1);
  check('real loop: tool result is sent back as a tool_result', log.length === 2 && log[1].messages[2].content[0].type === 'tool_result' && /ORD-9001/.test(log[1].messages[2].content[0].content));
  check('real loop: usage adds up across calls', res.info.usage.input === 250 && res.info.usage.output === 22);
  check('real loop: trace steps carry a part tag', res.trace.every(function (s) { return /^(Context|Memory|Tools|Guardrails|Model)$/.test(s.part); }));
  var off = ABS.workspaces.examples.shop.good(); off.rules.offTopicRefusal = true;
  return M.respond(off, 'write me a poem', cfgA, function () { calls++; return Promise.reject(new Error('should not be called')); });
}).then(function (res) {
  check('scope guardrail blocks before anything is sent', calls === 0 && res.info.blocked);
  return M.respond(wsR, 'hi', cfgA, function () { return Promise.reject(new TypeError('Failed to fetch')); });
}).then(function (res) {
  check('a network failure becomes a readable error, not a crash', res.info.error && /Could not reach/.test(res.reply));
  return ABS.grader.runAllAsync(wsR, function (w, q) { return Promise.resolve(ABS.sim.respond(w, q)); });
}).then(function (r) {
  check('runAllAsync with the simulator gives the same score as runAll', r.pct === ABS.grader.runAll(wsR).pct);
  check('export never includes model settings', ABS.store.toJSON({ exampleId: 'shop', ws: wsR, prices: {}, model: { key: 'not-a-real-key' } }).indexOf('not-a-real-key') < 0);
});

pending.then(function () {
  console.log('\n' + (count - failures) + ' of ' + count + ' checks passed');
  process.exit(failures ? 1 : 0);
}, function (e) { console.log('  FAIL async checks threw: ' + e.stack); process.exit(1); });
