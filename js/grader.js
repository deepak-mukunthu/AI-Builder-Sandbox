/* Tests: run each question through the simulator and check must-include / must-not-include words. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util;

  function runTest(ws, t) {
    var res = ABS.sim.respond(ws, t.q);
    var low = res.reply.toLowerCase(), checks = [];
    U.splitList(t.include).forEach(function (w) {
      checks.push({ label: 'includes "' + w + '"', ok: low.indexOf(w.toLowerCase()) >= 0 });
    });
    U.splitList(t.exclude).forEach(function (w) {
      checks.push({ label: 'does not include "' + w + '"', ok: low.indexOf(w.toLowerCase()) < 0 });
    });
    if (U.trim(t.tool)) {
      checks.push({ label: 'called tool ' + t.tool, ok: res.toolsCalled.indexOf(U.trim(t.tool)) >= 0 });
    }
    var pass = checks.every(function (c) { return c.ok; });
    return { pass: pass, checks: checks, result: res };
  }

  function runAll(ws) {
    var items = (ws.tests || []).map(function (t) { return runTest(ws, t); });
    var passed = items.filter(function (i) { return i.pass; }).length;
    var total = items.length;
    return { items: items, passed: passed, total: total, pct: total ? Math.round(100 * passed / total * 10) / 10 : 0 };
  }

  ABS.grader = { runTest: runTest, runAll: runAll };
})(typeof window !== 'undefined' ? window : globalThis);
