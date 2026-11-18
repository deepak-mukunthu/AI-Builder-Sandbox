/* Run with: node tests/run.js
   Loads the browser scripts into a vm context (no DOM needed) and checks the teaching examples. */
'use strict';
var vm = require('vm'), fs = require('fs'), path = require('path');
var JS = path.join(__dirname, '..', 'js');
var FILES = ['util', 'retrieval', 'simulator', 'grader', 'workspaces', 'store'];

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

console.log('\n' + (count - failures) + ' of ' + count + ' checks passed');
process.exit(failures ? 1 : 0);
