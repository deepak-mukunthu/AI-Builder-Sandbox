/* Knowledge: split documents into chunks, then rank chunks by keyword overlap with the question. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util;

  function sentences(text) {
    return (String(text || '').match(/[^.!?\n]+[.!?]*/g) || []).map(U.trim).filter(Boolean);
  }

  /* Pack whole sentences into chunks of at most `size` characters (a long sentence stays whole). */
  function chunkDoc(doc, size, docIndex) {
    var chunks = [], cur = '';
    sentences(doc.text).forEach(function (s) {
      if (cur && (cur.length + 1 + s.length) > size) { chunks.push(cur); cur = s; }
      else cur = cur ? cur + ' ' + s : s;
    });
    if (cur) chunks.push(cur);
    return chunks.map(function (t, i) {
      return { id: docIndex + '-' + i, title: doc.title || 'Untitled', label: (doc.title || 'Untitled') + ' #' + (i + 1), text: t };
    });
  }

  function chunkAll(docs, size) {
    size = Math.max(40, U.num(size, 300));
    var out = [];
    (docs || []).forEach(function (d, i) { out = out.concat(chunkDoc(d, size, i)); });
    return out;
  }

  /* Returns { all: every chunk with a score, picked: top-K chunks that pass the minimum score }. */
  function retrieve(docs, question, size, topK) {
    var qt = U.tokens(question);
    var all = chunkAll(docs, size).map(function (c, order) {
      var set = {};
      U.tokens(c.title + ' ' + c.text).forEach(function (t) { set[t] = 1; });
      var score = 0;
      qt.forEach(function (t) { if (set[t]) score++; });
      c.score = score; c.order = order;
      return c;
    });
    var minScore = qt.length <= 2 ? 1 : 2;
    var ranked = all.slice().sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    var k = Math.max(0, Math.floor(U.num(topK, 3)));
    var picked = ranked.filter(function (c) { return c.score >= minScore; }).slice(0, k);
    return { all: ranked, picked: picked, queryTokens: qt, minScore: minScore };
  }

  ABS.retrieval = { sentences: sentences, chunkAll: chunkAll, retrieve: retrieve };
})(typeof window !== 'undefined' ? window : globalThis);
