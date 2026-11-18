/* Small helpers shared by every other file. Plain script, no modules. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};

  var STOP = {};
  ('a an the is are was were be been am do does did can could should would will i me my we our you your it its ' +
   'of to for in on at by with and or as that this these those there what whats when where which who how many much ' +
   'get got have has had any each every about from if so than then too very please tell us ok okay').split(' ')
    .forEach(function (w) { STOP[w] = 1; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Very light stemming so "laptops" matches "laptop" and "replaced" matches "replace". */
  function stem(w) {
    if (/^\d/.test(w) || w.length <= 3) return w;
    if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    if (w.length > 4 && /ly$/.test(w)) w = w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    if (w.length > 4 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function tokens(s) {
    var out = [], seen = {};
    (String(s == null ? '' : s).toLowerCase().match(/[a-z0-9]+/g) || []).forEach(function (w) {
      if (STOP[w]) return;
      var t = stem(w);
      if (!seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function splitList(s) { return String(s == null ? '' : s).split(/[,\n;]/).map(trim).filter(Boolean); }
  function estimateTokens(text) { return Math.ceil(String(text == null ? '' : text).length / 4); }
  function money(n, digits) {
    n = num(n, 0);
    return '$' + n.toFixed(digits == null ? 2 : digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  ABS.util = { esc: esc, tokens: tokens, num: num, clone: clone, trim: trim, splitList: splitList,
               estimateTokens: estimateTokens, money: money };
})(typeof window !== 'undefined' ? window : globalThis);
