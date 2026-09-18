/* Arbitrage du seuil de décision : le visiteur choisit quelle part des valeurs part en
   validation automatique, et lit ce que ça coûte en erreurs livrées. Les points de la courbe
   sont les mesures du mémoire (assets/data/seuil.js) ; seules les conversions en nombre de
   fiches sont calculées ici. */
(function () {
  "use strict";

  var D = window.SEUIL, root = document.getElementById("seuil");
  if (!D || !root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var svg = document.getElementById("seuil-chart");
  var slider = document.getElementById("seuil-range");
  var headEl = document.getElementById("seuil-head");
  var statsEl = document.getElementById("seuil-stats");
  var noteEl = document.getElementById("seuil-note");
  var NS = "http://www.w3.org/2000/svg";
  var LOT = 10000;

  var pts = D.points;                       // [taux d'acceptation, précision, rappel]
  var idx = pts.reduce(function (best, p, i) {
    return Math.abs(p[1] - 0.99) < Math.abs(pts[best][1] - 0.99) ? i : best;
  }, 0);

  function pc(v, dec) {
    var s = (v * 100).toFixed(dec === undefined ? 1 : dec);
    return (EN ? s : s.replace(".", ",")) + " %";
  }
  function num(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, EN ? "," : " ");
  }

  /* ---------- graphique ---------- */
  var W = 520, H = 250, M = { l: 44, r: 12, t: 12, b: 34 };
  var Y0 = 0.6, Y1 = 1.0;
  function X(v) { return M.l + v * (W - M.l - M.r); }
  function Y(v) { return H - M.b - (v - Y0) / (Y1 - Y0) * (H - M.t - M.b); }

  function el(name, attrs, parent, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function path(k) {
    return pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[k]).toFixed(1); }).join(" ");
  }

  function draw() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var g = el("g", {}, svg);

    [0.6, 0.7, 0.8, 0.9, 1.0].forEach(function (v) {
      var l = el("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v) }, g);
      l.style.stroke = "var(--rule)";
      var t = el("text", { x: M.l - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 10.5 }, g, pc(v, 0));
      t.style.fill = "var(--muted)";
    });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var t = el("text", { x: X(v), y: H - 12, "text-anchor": "middle", "font-size": 10.5 }, g, pc(v, 0));
      t.style.fill = "var(--muted)";
    });
    var xl = el("text", { x: (M.l + W - M.r) / 2, y: H - 1, "text-anchor": "middle", "font-size": 10.5 }, g,
                tr("part des valeurs validées automatiquement", "share of values validated automatically"));
    xl.style.fill = "var(--muted)";

    // sans vérification : on livre tout, la précision tombe à la part déjà juste
    var base = el("line", { x1: M.l, x2: W - M.r, y1: Y(D.base), y2: Y(D.base), "stroke-dasharray": "4 4" }, g);
    base.style.stroke = "var(--muted)";
    var bl = el("text", { x: W - M.r, y: Y(D.base) - 6, "text-anchor": "end", "font-size": 10.5 }, g,
                tr("sans vérification : " + pc(D.base), "with no check: " + pc(D.base)));
    bl.style.fill = "var(--muted)";

    var defs = el("defs", {}, svg);
    var clip = el("clipPath", { id: "seuil-clip" }, defs);
    el("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b }, clip);
    var plot = el("g", { "clip-path": "url(#seuil-clip)" }, g);   // les courbes restent dans le cadre
    var rec = el("path", { d: path(2), fill: "none", "stroke-width": 1.4, "stroke-dasharray": "5 4" }, plot);
    rec.style.stroke = "var(--ink-2)";
    var pre = el("path", { d: path(1), fill: "none", "stroke-width": 2 }, plot);
    pre.style.stroke = "var(--accent)";

    Object.keys(D.targets).forEach(function (k) {
      var t = D.targets[k];
      var c = el("circle", { cx: X(t[0]), cy: Y(t[1]), r: 3.5 }, g);
      c.style.fill = "var(--paper)"; c.style.stroke = "var(--accent)";
    });

    var p = pts[idx];
    var v = el("line", { x1: X(p[0]), x2: X(p[0]), y1: M.t, y2: H - M.b, "stroke-width": 1 }, g);
    v.style.stroke = "var(--ink)";
    var dot = el("circle", { cx: X(p[0]), cy: Y(p[1]), r: 5 }, g);
    dot.style.fill = "var(--accent)";
    var lg = el("text", { x: M.l + 6, y: H - M.b - 10, "font-size": 10.5 }, g,
                tr("trait plein : précision · pointillé : rappel",
                   "solid: precision · dashed: recall"));
    lg.style.fill = "var(--muted)";
  }

  /* ---------- chiffres ---------- */
  function update() {
    var p = pts[idx], acc = p[0], prec = p[1];
    var accepted = LOT * acc, errors = accepted * (1 - prec), review = LOT - accepted;
    headEl.textContent = tr("Validées automatiquement ", "Validated automatically ") + pc(acc, 0)
      + tr(" · précision ", " · precision ") + pc(prec);
    statsEl.innerHTML = "";
    function stat(value, label) {
      var d = document.createElement("div");
      var n = document.createElement("b");
      n.textContent = value;
      var s = document.createElement("span");
      s.textContent = label;
      d.appendChild(n); d.appendChild(s);
      statsEl.appendChild(d);
    }
    stat(num(accepted), tr("valeurs livrées sans relecture, sur 10 000",
                           "values shipped without review, out of 10,000"));
    stat(num(errors), tr("erreurs qui passent malgré tout", "errors that still slip through"));
    stat(num(review), tr("valeurs envoyées à un humain", "values sent to a human"));
    stat(num(LOT * (1 - D.base)), tr("erreurs livrées si l'on ne vérifie rien",
                                     "errors shipped if nothing is checked"));
    draw();
  }

  slider.min = 0;
  slider.max = pts.length - 1;
  slider.value = idx;
  slider.addEventListener("input", function () { idx = parseInt(slider.value, 10); update(); });

  svg.addEventListener("click", function (e) {
    var r = svg.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * W;
    var v = (x - M.l) / (W - M.l - M.r);
    idx = pts.reduce(function (best, p, i) {
      return Math.abs(p[0] - v) < Math.abs(pts[best][0] - v) ? i : best;
    }, 0);
    slider.value = idx;
    update();
  });

  if (noteEl) {
    noteEl.textContent = tr(
      "Mesures du mémoire, système final (" + D.system + "), sur le jeu de test des catalogues "
      + "clients : seuls les taux agrégés sont publiés.",
      "Measurements from my master's thesis, final system (" + D.system + "), on the client "
      + "catalogue test set: only aggregate rates are published.");
  }
  update();
})();
