/* Solveur d'argumentation abstraite (Dung) : portage web de my_solver.py (dépôt
   argumentation-solver). Même algorithme : on parcourt tous les sous-ensembles d'arguments et
   on garde ceux qui sont sans conflit, qui défendent leurs membres et qui contiennent tout ce
   qu'ils défendent (extensions complètes), ou qui attaquent tout le reste (extensions stables). */
(function () {
  "use strict";

  var root = document.getElementById("arg");
  if (!root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var svg = document.getElementById("arg-graph");
  var outEl = document.getElementById("arg-out");
  var hintEl = document.getElementById("arg-hint");
  var addBtn = document.getElementById("arg-add");
  var delBtn = document.getElementById("arg-del");
  var exSel = document.getElementById("arg-example");
  var NS = "http://www.w3.org/2000/svg";
  var LETTERS = "ABCDEFGH";
  var MAXN = 8;

  var EXAMPLES = {
    chaine: { n: 3, att: [[0, 1], [1, 2]] },
    cycle: { n: 3, att: [[0, 1], [1, 2], [2, 0]] },
    dilemme: { n: 3, att: [[0, 1], [1, 0], [0, 2], [1, 2]] }
  };
  var args = [], attacks = [], selected = -1;

  /* ---------- le solveur, à l'identique ---------- */
  function has(a, b) {
    return attacks.some(function (t) { return t[0] === a && t[1] === b; });
  }
  function conflictFree(set) {
    for (var i = 0; i < set.length; i++)
      for (var j = 0; j < set.length; j++)
        if (has(set[i], set[j])) return false;
    return true;
  }
  function attackers(a) {
    return attacks.filter(function (t) { return t[1] === a; }).map(function (t) { return t[0]; });
  }
  function defended(a, set) {
    return attackers(a).every(function (att) {
      return set.some(function (d) { return has(d, att); });
    });
  }
  function isComplete(set) {
    if (!conflictFree(set)) return false;
    if (!set.every(function (a) { return defended(a, set); })) return false;
    for (var a = 0; a < args.length; a++)
      if (defended(a, set) && set.indexOf(a) < 0) return false;
    return true;
  }
  function isStable(set) {
    if (!conflictFree(set)) return false;
    for (var a = 0; a < args.length; a++) {
      if (set.indexOf(a) >= 0) continue;
      if (!set.some(function (s) { return has(s, a); })) return false;
    }
    return true;
  }
  function solve() {
    var complete = [], stable = [], n = args.length;
    for (var mask = 0; mask < (1 << n); mask++) {
      var set = [];
      for (var i = 0; i < n; i++) if (mask & (1 << i)) set.push(i);
      if (isComplete(set)) complete.push(set);
      if (isStable(set)) stable.push(set);
    }
    return { complete: complete, stable: stable };
  }

  /* ---------- dessin ---------- */
  function el(name, attrs, parent, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  var W = 460, H = 240, R = 22;
  function place() {
    var n = args.length, cx = W / 2, cy = H / 2, rad = n <= 1 ? 0 : Math.min(88, 26 + n * 12);
    args.forEach(function (a, i) {
      var t = -Math.PI / 2 + i * 2 * Math.PI / Math.max(n, 1);
      a.x = cx + rad * Math.cos(t) * 1.7;
      a.y = cy + rad * Math.sin(t);
    });
  }

  function draw() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var defs = el("defs", {}, svg);
    var mk = el("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5,
                            markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,1 L10,5 L0,9 z" }, mk).style.fill = "var(--ink-2)";
    var g = el("g", {}, svg);

    attacks.forEach(function (t) {
      var a = args[t[0]], b = args[t[1]];
      if (!a || !b) return;
      var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      var ux = dx / d, uy = dy / d;
      var bend = has(t[1], t[0]) ? 14 : 0;            // attaque réciproque : on écarte les deux traits
      var px = -uy * bend, py = ux * bend;
      var x1 = a.x + ux * R + px, y1 = a.y + uy * R + py;
      var x2 = b.x - ux * (R + 6) + px, y2 = b.y - uy * (R + 6) + py;
      var line = el("line", { x1: x1, y1: y1, x2: x2, y2: y2, "stroke-width": 1.4,
                              "marker-end": "url(#arrow)" }, g);
      line.style.stroke = "var(--ink-2)";
    });

    args.forEach(function (a, i) {
      var c = el("circle", { cx: a.x, cy: a.y, r: R }, g);
      c.style.fill = i === selected ? "var(--accent-soft)" : "var(--paper)";
      c.style.stroke = i === selected ? "var(--accent)" : "var(--rule-strong)";
      c.style.strokeWidth = i === selected ? 2 : 1;
      c.style.cursor = "pointer";
      var t = el("text", { x: a.x, y: a.y + 5, "text-anchor": "middle", "font-size": 15 }, g, a.id);
      t.style.fill = "var(--ink)";
      t.style.pointerEvents = "none";
      c.addEventListener("click", function () { tap(i); });
    });
  }

  function fmtSet(set) {
    return set.length ? "{ " + set.map(function (i) { return args[i].id; }).join(", ") + " }" : "{ }";
  }

  function show() {
    var r = solve();
    outEl.innerHTML = "";
    function block(title, list, empty) {
      var b = document.createElement("div");
      b.className = "arg-block";
      var h = document.createElement("span");
      h.className = "arg-title";
      h.textContent = title + " (" + list.length + ")";
      b.appendChild(h);
      var p = document.createElement("span");
      p.className = "arg-sets";
      p.textContent = list.length ? list.map(fmtSet).join("   ") : empty;
      b.appendChild(p);
      outEl.appendChild(b);
    }
    block(tr("Extensions complètes", "Complete extensions"), r.complete, tr("aucune", "none"));
    block(tr("Extensions stables", "Stable extensions"), r.stable,
          tr("aucune — c'est possible", "none — which does happen"));

    var tbl = document.createElement("div");
    tbl.className = "arg-accept";
    var head = document.createElement("div");
    head.className = "arg-arow arg-ahead";
    [tr("Argument", "Argument"), tr("crédule", "credulous"), tr("sceptique", "skeptical")]
      .forEach(function (t) { var s = document.createElement("span"); s.textContent = t; head.appendChild(s); });
    tbl.appendChild(head);
    args.forEach(function (a, i) {
      var cred = r.complete.some(function (e) { return e.indexOf(i) >= 0; });
      var skep = r.complete.length > 0 && r.complete.every(function (e) { return e.indexOf(i) >= 0; });
      var row = document.createElement("div");
      row.className = "arg-arow";
      var s0 = document.createElement("span"); s0.textContent = a.id; row.appendChild(s0);
      [cred, skep].forEach(function (v) {
        var s = document.createElement("span");
        s.className = "verdict " + (v ? "ok" : "ko");
        s.textContent = v ? tr("oui", "yes") : tr("non", "no");
        row.appendChild(s);
      });
      tbl.appendChild(row);
    });
    outEl.appendChild(tbl);
    hint();
  }

  function hint() {
    if (!hintEl) return;
    hintEl.textContent = selected >= 0
      ? tr("Touchez un second argument : " + args[selected].id + " l'attaquera (ou plus, si l'attaque existe déjà).",
           "Tap a second argument: " + args[selected].id + " will attack it (or stop attacking it).")
      : tr("Touchez un argument, puis un autre, pour créer ou retirer une attaque.",
           "Tap one argument, then another, to add or remove an attack.");
  }

  function tap(i) {
    if (selected < 0) { selected = i; }
    else if (selected === i) { selected = -1; }
    else {
      var k = attacks.findIndex(function (t) { return t[0] === selected && t[1] === i; });
      if (k >= 0) attacks.splice(k, 1); else attacks.push([selected, i]);
      selected = -1;
    }
    draw(); show();
  }

  function load(def) {
    args = [];
    for (var i = 0; i < def.n; i++) args.push({ id: LETTERS.charAt(i) });
    attacks = def.att.map(function (t) { return t.slice(); });
    selected = -1;
    place(); draw(); show();
  }

  if (addBtn) addBtn.addEventListener("click", function () {
    if (args.length >= MAXN) return;
    args.push({ id: LETTERS.charAt(args.length) });
    place(); draw(); show();
  });
  if (delBtn) delBtn.addEventListener("click", function () {
    var i = selected >= 0 ? selected : args.length - 1;
    if (i < 0) return;
    args.splice(i, 1);
    attacks = attacks.filter(function (t) { return t[0] !== i && t[1] !== i; })
      .map(function (t) { return [t[0] > i ? t[0] - 1 : t[0], t[1] > i ? t[1] - 1 : t[1]]; });
    args.forEach(function (a, k) { a.id = LETTERS.charAt(k); });
    selected = -1;
    place(); draw(); show();
  });
  if (exSel) exSel.addEventListener("change", function () { load(EXAMPLES[exSel.value]); });

  load(EXAMPLES.dilemme);
})();
