/* Tests: run each question through the simulator and check must-include / must-not-include words. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util;

  function runTest(ws, t) { return checkReply(t, ABS.sim.respond(ws, t.q)); }

  /* Score one test against a reply that is already in hand (from the simulator or a real model). */
  function checkReply(t, res) {
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

  function runAll(ws) { return summarise((ws.tests || []).map(function (t) { return runTest(ws, t); })); }

  /* Same as runAll, but asks respond(ws, q) for each reply, one test at a time. respond returns a Promise. */
  function runAllAsync(ws, respond, onProgress) {
    var tests = ws.tests || [], items = [];
    return tests.reduce(function (p, t, i) {
      return p.then(function () {
        if (onProgress) onProgress(i, tests.length);
        return respond(ws, t.q).then(function (res) { items.push(checkReply(t, res)); });
      });
    }, Promise.resolve()).then(function () { return summarise(items); });
  }

  function summarise(items) {
    var passed = items.filter(function (i) { return i.pass; }).length;
    var total = items.length;
    return { items: items, passed: passed, total: total, pct: total ? Math.round(100 * passed / total * 10) / 10 : 0 };
  }

  ABS.grader = { runTest: runTest, runAll: runAll, runAllAsync: runAllAsync, checkReply: checkReply };
})(typeof window !== 'undefined' ? window : globalThis);
