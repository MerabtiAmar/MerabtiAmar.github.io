/* Annotation budgétée : le visiteur étiquette lui-même les exemples que la stratégie lui
   présente, et voit la courbe d'apprentissage monter. Le modèle (régression logistique
   multinomiale) est réentraîné dans le navigateur après chaque étiquette ; les courbes de
   référence viennent de l'expérience Python (dépôt active-learning-budget). */
(function () {
  "use strict";

  var D = window.ANNOT, root = document.getElementById("al");
  if (!D || !root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var canvas = document.getElementById("al-digit");
  var keysEl = document.getElementById("al-keys");
  var chartEl = document.getElementById("al-chart");
  var scoreEl = document.getElementById("al-score");
  var noteEl = document.getElementById("al-note");
  var stratSel = document.getElementById("al-strategy");
  var resetBtn = document.getElementById("al-reset");
  var NS = "http://www.w3.org/2000/svg";
  var DIM = D.dim, K = 10;

  function unpack(b64, n) {
    var bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var out = new Float32Array(n * DIM);
    for (var i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i) / D.scale;
    return out;
  }
  var POOL = unpack(D.pool.x, D.pool.n), POOL_Y = D.pool.y;
  var TEST = unpack(D.test.x, D.test.n), TEST_Y = D.test.y;

  /* ---------- régression logistique multinomiale, entraînée ici ---------- */
  var W = new Float32Array(K * (DIM + 1));

  function logits(X, i, out) {
    for (var c = 0; c < K; c++) {
      var s = W[c * (DIM + 1) + DIM];
      for (var j = 0; j < DIM; j++) s += W[c * (DIM + 1) + j] * X[i * DIM + j];
      out[c] = s;
    }
    var m = out[0];
    for (c = 1; c < K; c++) if (out[c] > m) m = out[c];
    var z = 0;
    for (c = 0; c < K; c++) { out[c] = Math.exp(out[c] - m); z += out[c]; }
    for (c = 0; c < K; c++) out[c] /= z;
    return out;
  }

  function train(idx, labels, iters) {
    W = new Float32Array(K * (DIM + 1));
    if (!idx.length) return;
    var lr = 0.5, l2 = 1e-3, p = new Float32Array(K), grad = new Float32Array(W.length);
    for (var it = 0; it < (iters || 260); it++) {
      grad.fill(0);
      for (var n = 0; n < idx.length; n++) {
        logits(POOL, idx[n], p);
        for (var c = 0; c < K; c++) {
          var g = p[c] - (labels[n] === c ? 1 : 0);
          if (!g) continue;
          var base = c * (DIM + 1);
          for (var j = 0; j < DIM; j++) grad[base + j] += g * POOL[idx[n] * DIM + j];
          grad[base + DIM] += g;
        }
      }
      var scale = lr / idx.length;
      for (var w = 0; w < W.length; w++) W[w] -= scale * grad[w] + lr * l2 * W[w];
    }
  }

  function accuracy() {
    var p = new Float32Array(K), ok = 0;
    for (var i = 0; i < D.test.n; i++) {
      logits(TEST, i, p);
      var best = 0;
      for (var c = 1; c < K; c++) if (p[c] > p[best]) best = c;
      if (best === TEST_Y[i]) ok++;
    }
    return ok / D.test.n;
  }

  /* ---------- stratégies, comme dans l'expérience ---------- */
  function margins(pool) {
    var p = new Float32Array(K);
    return pool.map(function (i) {
      logits(POOL, i, p);
      var a = -1, b = -1;
      for (var c = 0; c < K; c++) { if (p[c] > a) { b = a; a = p[c]; } else if (p[c] > b) b = p[c]; }
      return { i: i, m: a - b };
    });
  }
  function dist(i, j) {
    var s = 0;
    for (var k = 0; k < DIM; k++) { var d = POOL[i * DIM + k] - POOL[j * DIM + k]; s += d * d; }
    return Math.sqrt(s);
  }
  function pick(strategy, pool, labelled) {
    if (strategy === "aleatoire" || !labelled.length) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
    var ms = margins(pool).sort(function (a, b) { return a.m - b.m; });
    if (strategy === "marge") return ms[0].i;
    var cand = ms.slice(0, Math.min(20, ms.length));      // ambiguïté, puis le plus éloigné du déjà vu
    var best = cand[0].i, bestD = -1;
    cand.forEach(function (c) {
      var d = Math.min.apply(null, labelled.map(function (l) { return dist(c.i, l); }));
      if (d > bestD) { bestD = d; best = c.i; }
    });
    return best;
  }

  /* ---------- état ---------- */
  var pool, labelled, labels, history, current;

  function reset() {
    W = new Float32Array(K * (DIM + 1));
    pool = [];
    for (var i = 0; i < D.pool.n; i++) pool.push(i);
    labelled = []; labels = []; history = [];
    for (var s = 0; s < D.start; s++) {                  // amorce déjà étiquetée, comme en Python
      var k = Math.floor(Math.random() * pool.length);
      labelled.push(pool[k]); labels.push(POOL_Y[pool[k]]); pool.splice(k, 1);
    }
    train(labelled, labels);
    history.push([labelled.length, accuracy()]);
    next();
  }

  function next() {
    current = pick(stratSel ? stratSel.value : "marge", pool, labelled);
    drawDigit();
    update();
  }

  function answer(c) {
    if (current === undefined) return;
    labelled.push(current);
    labels.push(c);
    pool.splice(pool.indexOf(current), 1);
    train(labelled, labels);
    history.push([labelled.length, accuracy()]);
    next();
  }

  /* ---------- affichage ---------- */
  function drawDigit() {
    var ctx = canvas.getContext("2d"), n = 8, size = canvas.width / n;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#000";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var v = POOL[current * DIM + r * n + c];
        if (v <= 0) continue;
        ctx.globalAlpha = Math.min(1, v);
        ctx.fillStyle = ink;
        ctx.fillRect(c * size, r * size, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function el(name, attrs, parent, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  var CW = 420, CH = 200, M = { l: 40, r: 10, t: 10, b: 28 };
  function chart() {
    var maxN = Math.max(60, history[history.length - 1][0] + 10);
    function X(v) { return M.l + Math.min(1, v / maxN) * (CW - M.l - M.r); }
    function Y(v) { return CH - M.b - (v - 0.2) / 0.8 * (CH - M.t - M.b); }
    while (chartEl.firstChild) chartEl.removeChild(chartEl.firstChild);
    chartEl.setAttribute("viewBox", "0 0 " + CW + " " + CH);
    var g = el("g", {}, chartEl);
    [0.2, 0.4, 0.6, 0.8, 1.0].forEach(function (v) {
      var l = el("line", { x1: M.l, x2: CW - M.r, y1: Y(v), y2: Y(v) }, g);
      l.style.stroke = "var(--rule)";
      var t = el("text", { x: M.l - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 9.5 }, g,
                 Math.round(v * 100) + " %");
      t.style.fill = "var(--muted)";
    });
    var xt = el("text", { x: (M.l + CW - M.r) / 2, y: CH - 4, "text-anchor": "middle", "font-size": 9.5 },
                g, tr("étiquettes données", "labels given"));
    xt.style.fill = "var(--muted)";

    function line(points, color, dash, width) {
      var d = points.filter(function (p) { return p[0] <= maxN; })
        .map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join(" ");
      if (!d) return;
      var path = el("path", { d: d, fill: "none", "stroke-width": width || 1.2 }, g);
      path.style.stroke = color;
      if (dash) path.setAttribute("stroke-dasharray", dash);
    }
    line(D.curves.aleatoire, "var(--muted)", "4 3");
    line(D.curves["marge+diversite"], "var(--ink-2)", "4 3");
    line(history, "var(--accent)", null, 2.2);
    var last = history[history.length - 1];
    var dot = el("circle", { cx: X(last[0]), cy: Y(last[1]), r: 4 }, g);
    dot.style.fill = "var(--accent)";
    var lg = el("text", { x: M.l + 4, y: M.t + 10, "font-size": 9.5 }, g,
                tr("vous · en pointillé : hasard et marge + diversité mesurés en Python",
                   "you · dashed: random and margin + diversity measured in Python"));
    lg.style.fill = "var(--muted)";
  }

  function update() {
    var last = history[history.length - 1];
    scoreEl.textContent = last[0] + tr(" étiquettes · ", " labels · ")
      + (last[1] * 100).toFixed(1).replace(".", EN ? "." : ",") + tr(" % sur le test", "% on the test set");
    chart();
  }

  for (var c = 0; c < K; c++) {
    (function (v) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = String(v);
      b.addEventListener("click", function () { answer(v); });
      keysEl.appendChild(b);
    })(c);
  }
  if (stratSel) stratSel.addEventListener("change", reset);
  if (resetBtn) resetBtn.addEventListener("click", reset);
  document.addEventListener("keydown", function (e) {
    if (e.key >= "0" && e.key <= "9" && document.activeElement !== stratSel) {
      var r = canvas.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) answer(parseInt(e.key, 10));
    }
  });

  if (noteEl) {
    noteEl.textContent = tr(
      "Le modèle repart de zéro après chaque étiquette : régression logistique entraînée ici, "
      + "testée sur " + D.test.n + " images jamais vues. Vos erreurs d'étiquetage comptent, "
      + "comme dans la vraie vie.",
      "The model is retrained from scratch after every label: logistic regression trained here, "
      + "tested on " + D.test.n + " unseen images. Your labelling mistakes count, as they would "
      + "in real life.");
  }
  reset();
})();
