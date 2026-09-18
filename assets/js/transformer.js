/* Bac à sable du Transformer minuscule : on écrit une suite de lettres, le modèle prédit la
   suivante, on regarde où chaque tête porte son attention, et on coupe une tête pour voir ce
   qu'elle apportait. Le modèle tourne dans la page (assets/js/induction.js). */
(function () {
  "use strict";

  var root = document.getElementById("tt");
  if (!root || !window.TINY || !window.TINYT || !window.TINY.init(window.TINYT)) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var M = window.TINY.model(), cfg = M.cfg;
  var seqEl = document.getElementById("tt-seq");
  var presetEl = document.getElementById("tt-preset");
  var stripEl = document.getElementById("tt-strip");
  var headsEl = document.getElementById("tt-heads");
  var detailEl = document.getElementById("tt-detail");
  var scoreEl = document.getElementById("tt-score");
  var noteEl = document.getElementById("tt-note");

  var LETTERS = "abcdefghijklmnopqrstuvwxyz";
  var BOS = 26, MAXLEN = cfg.seq_len - 1;
  var ablate = [], selected = null, cache = null;

  function motif(period, total) {
    var s = "";
    for (var i = 0; i < period; i++) s += LETTERS.charAt(Math.floor(Math.random() * 26));
    var out = "";
    while (out.length < total) out += s;
    return out.slice(0, total);
  }

  function tokens() {
    var txt = (seqEl.value || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, MAXLEN);
    var t = [BOS];
    for (var i = 0; i < txt.length; i++) t.push(LETTERS.indexOf(txt.charAt(i)));
    return t;
  }

  function letter(i) { return i === BOS ? "·" : LETTERS.charAt(i); }

  /* position dont la suite est lisible dans le contexte : le jeton courant est déjà apparu,
     suivi d'une lettre — c'est ce que la tête d'induction doit retrouver */
  function attendu(t, i) {
    for (var j = i - 1; j >= 1; j--) if (t[j] === t[i] && j + 1 < t.length) return t[j + 1];
    return null;
  }

  function run() {
    var t = tokens();
    if (t.length < 2) { stripEl.innerHTML = ""; return; }
    cache = { t: t, out: window.TINY.forward(t, ablate) };
    draw();
  }

  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function draw() {
    var t = cache.t, out = cache.out, T = t.length;
    stripEl.innerHTML = "";
    var bons = 0, possibles = 0;
    for (var i = 0; i < T; i++) {
      var cell = el("div", "tt-cell" + (selected === i ? " sel" : ""), null, stripEl);
      el("span", "tt-tok", letter(t[i]), cell);
      var p = window.TINY.softmax(out.logits[i]);
      var best = 0;
      for (var c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
      var att = attendu(t, i);
      var ok = att !== null && best === att;
      if (att !== null) { possibles++; if (ok) bons++; }
      var pr = el("span", "tt-pred" + (att === null ? "" : (ok ? " ok" : " ko")), letter(best), cell);
      pr.title = tr("probabilité ", "probability ") + Math.round(p[best] * 100) + " %";
      var bar = el("span", "tt-bar", null, cell);
      el("i", null, null, bar).style.width = Math.round(p[best] * 100) + "%";
      (function (k) { cell.addEventListener("click", function () { selected = k; draw(); }); })(i);
    }
    scoreEl.textContent = possibles
      ? tr("suite lisible dans le contexte : ", "continuation readable from context: ")
        + bons + "/" + possibles
      : tr("écrivez un motif qui se répète", "type a repeating pattern");
    heads();
    detail();
  }

  function heads() {
    headsEl.innerHTML = "";
    var T = cache.t.length;
    for (var l = 0; l < cfg.n_layers; l++) {
      for (var h = 0; h < cfg.n_heads; h++) {
        (function (l, h) {
          var box = el("div", "tt-head", null, headsEl);
          var top = el("div", "tt-head-top", null, box);
          el("span", null, tr("couche ", "layer ") + l + tr(" · tête ", " · head ") + h, top);
          var lab = el("label", "tt-off", null, top);
          var cb = el("input", null, null, lab);
          cb.type = "checkbox";
          cb.checked = ablate.some(function (a) { return a[0] === l && a[1] === h; });
          lab.appendChild(document.createTextNode(tr("couper", "ablate")));
          cb.addEventListener("change", function () {
            ablate = ablate.filter(function (a) { return !(a[0] === l && a[1] === h); });
            if (cb.checked) ablate.push([l, h]);
            run();
          });
          var cv = el("canvas", "tt-map", null, box);
          cv.width = cv.height = 132;
          var ctx = cv.getContext("2d");
          var s = cv.width / T;
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
          ctx.fillRect(0, 0, cv.width, cv.height);
          var ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
          var acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
          var A = cache.out.attentions[l][h];
          for (var i = 0; i < T; i++) {
            for (var j = 0; j <= i; j++) {
              var v = A[i][j];
              if (v < 0.02) continue;
              ctx.globalAlpha = Math.min(1, v * 1.4);
              ctx.fillStyle = selected === i ? acc : ink;
              ctx.fillRect(j * s, i * s, Math.max(1, s), Math.max(1, s));
            }
          }
          ctx.globalAlpha = 1;
          cv.addEventListener("click", function (e) {
            var r = cv.getBoundingClientRect();
            selected = Math.min(T - 1, Math.floor((e.clientY - r.top) / r.height * T));
            draw();
          });
          cv.setAttribute("role", "img");
          cv.setAttribute("aria-label", tr("carte d'attention, couche ", "attention map, layer ")
            + l + tr(", tête ", ", head ") + h);
        })(l, h);
      }
    }
  }

  function detail() {
    detailEl.innerHTML = "";
    if (selected === null) {
      el("p", "tt-hint", tr("Touchez une lettre : vous verrez où chaque tête regarde pour la prédire.",
                            "Tap a letter: you will see where each head looks to predict it."), detailEl);
      return;
    }
    var t = cache.t, i = selected;
    var head = el("p", "tt-hint", tr("Position ", "Position ") + i + tr(" · lettre « ", " · letter “")
      + letter(t[i]) + tr(" » · où regardent les têtes :", "” · where the heads look:"), detailEl);
    for (var l = 0; l < cfg.n_layers; l++) {
      for (var h = 0; h < cfg.n_heads; h++) {
        var A = cache.out.attentions[l][h][i];
        var bestJ = 0;
        for (var j = 1; j <= i; j++) if (A[j] > A[bestJ]) bestJ = j;
        var line = el("div", "tt-look", null, detailEl);
        el("span", "who", tr("couche ", "layer ") + l + "·" + h, line);
        el("span", "what", tr("position ", "position ") + bestJ + " (« " + letter(t[bestJ]) + " »)"
           + " — " + Math.round(A[bestJ] * 100) + " %", line);
        var kind = "";
        if (bestJ === i - 1) kind = tr("jeton précédent", "previous token");
        else if (bestJ >= 1 && t[bestJ - 1] === t[i]) kind = tr("induction", "induction");
        el("span", "kind", kind, line);
      }
    }
  }

  function setPreset() {
    var v = presetEl.value;
    if (v === "aleatoire") seqEl.value = motif(3 + Math.floor(Math.random() * 6), MAXLEN);
    else if (v === "abc") seqEl.value = motif(3, MAXLEN).replace(/./g, function (c, k) {
      return "abc".charAt(k % 3);
    });
    else if (v === "long") seqEl.value = motif(11, MAXLEN);
    run();
  }

  seqEl.addEventListener("input", function () { selected = null; run(); });
  if (presetEl) presetEl.addEventListener("change", setPreset);
  if (noteEl) {
    var params = M.meta.params;
    noteEl.textContent = tr(
      params + " paramètres, deux couches, deux têtes, exécutés dans cette page. Couper la tête "
      + "« jeton précédent » de la couche 0 suffit à détruire la recopie.",
      params + " parameters, two layers, two heads, running in this page. Ablating the "
      + "“previous token” head in layer 0 is enough to destroy the copying.");
  }
  seqEl.value = motif(5, MAXLEN);
  run();
})();
