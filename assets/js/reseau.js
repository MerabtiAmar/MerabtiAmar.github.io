/* Réseau de neurones à régler à la main : portage web de nn_visualizer.py (dépôt
   neural-network-visualizer). Même calcul qu'à l'origine : valeur = activation(Σ poids × entrée
   + biais), activation par seuil (1 si la somme est positive, 0 sinon). Le défi est celui du
   dépôt : obtenir un XOR avec deux neurones cachés. */
(function () {
  "use strict";

  var root = document.getElementById("nn");
  if (!root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var svg = document.getElementById("nn-graph");
  var ctrlEl = document.getElementById("nn-controls");
  var tableEl = document.getElementById("nn-table");
  var statusEl = document.getElementById("nn-status");
  var actSel = document.getElementById("nn-activation");
  var solveBtn = document.getElementById("nn-solve");
  var zeroBtn = document.getElementById("nn-zero");
  var NS = "http://www.w3.org/2000/svg";

  // la solution du dépôt : examples/xor.json
  var XOR = { w: [1, 1, 1, 1, -1, 1], b: [-1.5, -0.5, -0.5] };
  var ZERO = { w: [0, 0, 0, 0, 0, 0], b: [0, 0, 0] };
  // w : x1->h1, x1->h2, x2->h1, x2->h2, h1->y, h2->y   ·   b : h1, h2, y
  var net = { w: ZERO.w.slice(), b: ZERO.b.slice() };
  var inputs = [1, 0];
  var STEP = 0.5, LIM = 2;

  function act(x) {
    var kind = actSel ? actSel.value : "seuil";
    if (kind === "sigmoide") return 1 / (1 + Math.exp(-x));
    if (kind === "relu") return Math.max(0, x);
    return x > 0 ? 1 : 0;                       // seuil, comme dans le dépôt
  }

  function forward(x) {
    var h1 = act(x[0] * net.w[0] + x[1] * net.w[2] + net.b[0]);
    var h2 = act(x[0] * net.w[1] + x[1] * net.w[3] + net.b[1]);
    var y = act(h1 * net.w[4] + h2 * net.w[5] + net.b[2]);
    return { h1: h1, h2: h2, y: y };
  }

  function fmt(v) {
    var s = (Math.round(v * 100) / 100).toString();
    return EN ? s : s.replace(".", ",");
  }

  /* ---------- dessin ---------- */
  function el(name, attrs, parent, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  var POS = { x: [[60, 55], [60, 145]], h: [[230, 55], [230, 145]], y: [[400, 100]] };
  var LINKS = [[0, 0], [0, 1], [1, 0], [1, 1]];   // [entrée, caché] pour w0..w3

  function draw() {
    var out = forward(inputs);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 460 200");
    var g = el("g", {}, svg);

    function link(a, b, w, label) {
      var line = el("line", { x1: a[0] + 24, y1: a[1], x2: b[0] - 24, y2: b[1],
                              "stroke-width": Math.min(3.4, 0.7 + Math.abs(w) * 1.1) }, g);
      line.style.stroke = w < 0 ? "var(--accent)" : "var(--ink)";
      line.style.opacity = w === 0 ? 0.18 : 0.75;
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      var t = el("text", { x: mx, y: my - 5, "text-anchor": "middle", "font-size": 11 }, g, label);
      t.style.fill = "var(--muted)";
    }
    LINKS.forEach(function (lk, i) { link(POS.x[lk[0]], POS.h[lk[1]], net.w[i], fmt(net.w[i])); });
    link(POS.h[0], POS.y[0], net.w[4], fmt(net.w[4]));
    link(POS.h[1], POS.y[0], net.w[5], fmt(net.w[5]));

    function node(p, value, label, bias) {
      var c = el("circle", { cx: p[0], cy: p[1], r: 24 }, g);
      c.style.fill = "var(--paper)";
      c.style.stroke = value >= 0.5 ? "var(--accent)" : "var(--rule-strong)";
      c.style.strokeWidth = value >= 0.5 ? 2 : 1;
      var v = el("text", { x: p[0], y: p[1] + 5, "text-anchor": "middle", "font-size": 14 }, g, fmt(value));
      v.style.fill = "var(--ink)";
      var l = el("text", { x: p[0], y: p[1] - 32, "text-anchor": "middle", "font-size": 11 }, g, label);
      l.style.fill = "var(--muted)";
      if (bias !== undefined) {
        var bt = el("text", { x: p[0], y: p[1] + 42, "text-anchor": "middle", "font-size": 11 }, g,
                    tr("biais ", "bias ") + fmt(bias));
        bt.style.fill = "var(--muted)";
      }
    }
    node(POS.x[0], inputs[0], "x₁");
    node(POS.x[1], inputs[1], "x₂");
    node(POS.h[0], out.h1, "h₁", net.b[0]);
    node(POS.h[1], out.h2, "h₂", net.b[1]);
    node(POS.y[0], out.y, tr("sortie", "output"), net.b[2]);
  }

  /* ---------- réglages ---------- */
  function stepper(label, get, set) {
    var wrap = document.createElement("div");
    wrap.className = "nn-row";
    var name = document.createElement("span");
    name.className = "nn-name";
    name.textContent = label;
    var minus = document.createElement("button");
    minus.type = "button"; minus.textContent = "−";
    minus.setAttribute("aria-label", label + " −");
    var val = document.createElement("span");
    val.className = "nn-val";
    var plus = document.createElement("button");
    plus.type = "button"; plus.textContent = "+";
    plus.setAttribute("aria-label", label + " +");
    function show() { val.textContent = fmt(get()); }
    minus.addEventListener("click", function () { set(Math.max(-LIM, get() - STEP)); refresh(); });
    plus.addEventListener("click", function () { set(Math.min(LIM, get() + STEP)); refresh(); });
    wrap.appendChild(name); wrap.appendChild(minus); wrap.appendChild(val); wrap.appendChild(plus);
    wrap._show = show;
    show();
    return wrap;
  }

  var rows = [];
  function buildControls() {
    ctrlEl.innerHTML = "";
    var names = ["x₁ → h₁", "x₁ → h₂", "x₂ → h₁", "x₂ → h₂", "h₁ → " + tr("sortie", "output"),
                 "h₂ → " + tr("sortie", "output")];
    names.forEach(function (n, i) {
      var r = stepper(n, function () { return net.w[i]; }, function (v) { net.w[i] = v; });
      rows.push(r); ctrlEl.appendChild(r);
    });
    [tr("biais h₁", "bias h₁"), tr("biais h₂", "bias h₂"), tr("biais sortie", "bias output")]
      .forEach(function (n, i) {
        var r = stepper(n, function () { return net.b[i]; }, function (v) { net.b[i] = v; });
        rows.push(r); ctrlEl.appendChild(r);
      });
  }

  /* ---------- table de vérité et défi ---------- */
  var COMBOS = [[0, 0], [0, 1], [1, 0], [1, 1]];
  function buildTable() {
    tableEl.innerHTML = "";
    var head = document.createElement("div");
    head.className = "nn-trow nn-thead";
    [tr("x₁", "x₁"), tr("x₂", "x₂"), tr("sortie", "output"), tr("XOR attendu", "XOR target")]
      .forEach(function (h) { var s = document.createElement("span"); s.textContent = h; head.appendChild(s); });
    tableEl.appendChild(head);
    var good = 0;
    COMBOS.forEach(function (c) {
      var o = forward(c), want = c[0] ^ c[1], ok = (o.y >= 0.5 ? 1 : 0) === want;
      if (ok) good++;
      var row = document.createElement("div");
      row.className = "nn-trow" + (ok ? " ok" : " ko");
      [c[0], c[1], fmt(o.y), want].forEach(function (v) {
        var s = document.createElement("span"); s.textContent = v; row.appendChild(s);
      });
      row.addEventListener("click", function () { inputs = c.slice(); refresh(); });
      tableEl.appendChild(row);
    });
    statusEl.textContent = good === 4
      ? tr("Les quatre combinaisons sont bonnes : c'est un XOR.",
           "All four combinations are right: that is a XOR.")
      : tr(good + " combinaison" + (good > 1 ? "s" : "") + " sur 4",
           good + " of 4 combinations right");
    statusEl.className = "nn-status" + (good === 4 ? " done" : "");
  }

  function refresh() {
    rows.forEach(function (r) { r._show(); });
    draw();
    buildTable();
  }

  root.querySelectorAll("[data-input]").forEach(function (b) {
    b.addEventListener("click", function () {
      var k = parseInt(b.getAttribute("data-input"), 10);
      inputs[k] = inputs[k] ? 0 : 1;
      b.textContent = (k === 0 ? "x₁ = " : "x₂ = ") + inputs[k];
      refresh();
    });
    var k = parseInt(b.getAttribute("data-input"), 10);
    b.textContent = (k === 0 ? "x₁ = " : "x₂ = ") + inputs[k];
  });
  if (solveBtn) solveBtn.addEventListener("click", function () {
    net = { w: XOR.w.slice(), b: XOR.b.slice() };
    refresh();
  });
  if (zeroBtn) zeroBtn.addEventListener("click", function () {
    net = { w: ZERO.w.slice(), b: ZERO.b.slice() };
    refresh();
  });
  if (actSel) actSel.addEventListener("change", refresh);

  buildControls();
  refresh();
})();
