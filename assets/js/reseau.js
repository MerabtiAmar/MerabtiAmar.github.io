/* Éditeur de réseau de neurones : portage web de nn_visualizer.py (dépôt
   neural-network-visualizer). On construit l'architecture, on relie les neurones, on règle
   poids et biais, et on lit la propagation avant — valeur = activation(Σ poids × entrée + biais),
   activation par seuil par défaut (1 si la somme est positive, 0 sinon), comme à l'origine.
   Le format JSON d'export est celui du fichier examples/xor.json. */
(function () {
  "use strict";

  var root = document.getElementById("nn");
  if (!root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var svg = document.getElementById("nn-graph");
  var panelEl = document.getElementById("nn-panel");
  var tableEl = document.getElementById("nn-table");
  var statusEl = document.getElementById("nn-status");
  var inputsEl = document.getElementById("nn-inputs");
  var actSel = document.getElementById("nn-activation");
  var NS = "http://www.w3.org/2000/svg";
  var STEP = 0.5, LIM = 4;

  /* net.layers[l] = [{bias}] · net.links = [{f:[l,i], t:[l,i], w}] · net.in = [valeurs] */
  var net, sel = null;                        // sel : {kind:"neuron"|"link", ...}

  function empty() {
    return { layers: [[{ bias: 0 }, { bias: 0 }], [{ bias: 0 }]], links: [], in: [1, 0] };
  }
  function xor() {
    return {
      layers: [[{ bias: 0 }, { bias: 0 }], [{ bias: -1.5 }, { bias: -0.5 }], [{ bias: -0.5 }]],
      links: [{ f: [0, 0], t: [1, 0], w: 1 }, { f: [0, 0], t: [1, 1], w: 1 },
              { f: [0, 1], t: [1, 0], w: 1 }, { f: [0, 1], t: [1, 1], w: 1 },
              { f: [1, 0], t: [2, 0], w: -1 }, { f: [1, 1], t: [2, 0], w: 1 }],
      in: [1, 0]
    };
  }

  function act(x) {
    var kind = actSel ? actSel.value : "seuil";
    if (kind === "sigmoide") return 1 / (1 + Math.exp(-x));
    if (kind === "relu") return Math.max(0, x);
    return x > 0 ? 1 : 0;
  }

  function forward(inputs) {
    var vals = net.layers.map(function (L) { return L.map(function () { return 0; }); });
    net.layers[0].forEach(function (n, i) { vals[0][i] = inputs[i] === undefined ? 0 : inputs[i]; });
    for (var l = 1; l < net.layers.length; l++) {
      for (var i = 0; i < net.layers[l].length; i++) {
        var sum = net.layers[l][i].bias;
        net.links.forEach(function (k) {
          if (k.t[0] === l && k.t[1] === i) sum += k.w * vals[k.f[0]][k.f[1]];
        });
        vals[l][i] = act(sum);
      }
    }
    return vals;
  }

  function fmt(v) {
    var s = (Math.round(v * 100) / 100).toString();
    return EN ? s : s.replace(".", ",");
  }
  function label(l, i) {
    if (l === 0) return "x" + (i + 1);
    if (l === net.layers.length - 1) return tr("s", "y") + (i + 1);
    return "h" + l + "." + (i + 1);
  }

  /* ---------- dessin ---------- */
  function el(name, attrs, parent, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  var W = 560, R = 21;
  function geometry() {
    var nl = net.layers.length;
    var maxN = Math.max.apply(null, net.layers.map(function (L) { return L.length; }));
    var H = Math.max(200, 66 + maxN * 78);
    var pos = net.layers.map(function (L, l) {
      var x = nl === 1 ? W / 2 : 56 + l * (W - 112) / (nl - 1);
      return L.map(function (n, i) {
        return [x, H / 2 + (i - (L.length - 1) / 2) * 78];
      });
    });
    return { H: H, pos: pos };
  }

  function draw() {
    var g0 = geometry(), pos = g0.pos, H = g0.H;
    var vals = forward(net.in);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 " + W + " " + (H + 34));
    var g = el("g", {}, svg);

    net.links.forEach(function (k, ki) {
      var a = pos[k.f[0]][k.f[1]], b = pos[k.t[0]][k.t[1]];
      if (!a || !b) return;
      var on = sel && sel.kind === "link" && sel.i === ki;
      var line = el("line", { x1: a[0] + R, y1: a[1], x2: b[0] - R, y2: b[1],
                              "stroke-width": on ? 3 : Math.min(3, 0.7 + Math.abs(k.w) * 0.9) }, g);
      line.style.stroke = on ? "var(--accent)" : (k.w < 0 ? "var(--accent)" : "var(--ink)");
      line.style.opacity = k.w === 0 ? 0.2 : (on ? 1 : 0.7);
      line.style.cursor = "pointer";
      line.addEventListener("click", function (e) { e.stopPropagation(); select({ kind: "link", i: ki }); });
      var hit = el("line", { x1: a[0] + R, y1: a[1], x2: b[0] - R, y2: b[1], "stroke-width": 14 }, g);
      hit.style.stroke = "transparent"; hit.style.cursor = "pointer";
      hit.addEventListener("click", function (e) { e.stopPropagation(); select({ kind: "link", i: ki }); });
      var t = el("text", { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 5, "text-anchor": "middle",
                           "font-size": 11 }, g, fmt(k.w));
      t.style.fill = on ? "var(--accent)" : "var(--muted)";
      t.style.pointerEvents = "none";
    });

    net.layers.forEach(function (L, l) {
      L.forEach(function (n, i) {
        var p = pos[l][i];
        var on = sel && sel.kind === "neuron" && sel.l === l && sel.i === i;
        var src = sel && sel.kind === "neuron" && !on;
        var c = el("circle", { cx: p[0], cy: p[1], r: R }, g);
        c.style.fill = on ? "var(--accent-soft)" : "var(--paper)";
        c.style.stroke = on ? "var(--accent)" : (vals[l][i] >= 0.5 ? "var(--accent)" : "var(--rule-strong)");
        c.style.strokeWidth = on || vals[l][i] >= 0.5 ? 2 : 1;
        c.style.cursor = "pointer";
        c.addEventListener("click", function (e) { e.stopPropagation(); tap(l, i); });
        var v = el("text", { x: p[0], y: p[1] + 5, "text-anchor": "middle", "font-size": 13 }, g, fmt(vals[l][i]));
        v.style.fill = "var(--ink)"; v.style.pointerEvents = "none";
        var lb = el("text", { x: p[0], y: p[1] - R - 7, "text-anchor": "middle", "font-size": 10.5 }, g, label(l, i));
        lb.style.fill = "var(--muted)"; lb.style.pointerEvents = "none";
        if (l > 0) {
          var bt = el("text", { x: p[0], y: p[1] + R + 13, "text-anchor": "middle", "font-size": 10 }, g,
                      "b " + fmt(n.bias));
          bt.style.fill = "var(--muted)"; bt.style.pointerEvents = "none";
        }
        if (src) c.style.strokeDasharray = "3 3";
      });
      // boutons par couche : ajouter ou retirer un neurone
      var x = pos[l][0][0], y = H + 18;
      [["−", function () { removeNeuron(l); }], ["+", function () { addNeuron(l); }]].forEach(function (b, k) {
        var bx = x + (k ? 12 : -12);
        var r = el("rect", { x: bx - 10, y: y - 12, width: 20, height: 18, rx: 2 }, g);
        r.style.fill = "var(--paper)"; r.style.stroke = "var(--rule-strong)"; r.style.cursor = "pointer";
        var t = el("text", { x: bx, y: y + 2, "text-anchor": "middle", "font-size": 12 }, g, b[0]);
        t.style.fill = "var(--ink-2)"; t.style.pointerEvents = "none";
        r.addEventListener("click", function (e) { e.stopPropagation(); b[1](); });
        r.setAttribute("aria-label", (k ? tr("ajouter un neurone", "add a neuron")
                                        : tr("retirer un neurone", "remove a neuron")));
      });
    });
    svg.addEventListener("click", function () { select(null); });
  }

  /* ---------- édition ---------- */
  function tap(l, i) {
    if (sel && sel.kind === "neuron") {
      if (sel.l === l && sel.i === i) { select(null); return; }
      var a = sel.l < l ? sel : { l: l, i: i }, b = sel.l < l ? { l: l, i: i } : sel;
      if (a.l === b.l) { select({ kind: "neuron", l: l, i: i }); return; }   // même couche : on change de sélection
      var k = net.links.findIndex(function (x) {
        return x.f[0] === a.l && x.f[1] === a.i && x.t[0] === b.l && x.t[1] === b.i;
      });
      if (k >= 0) net.links.splice(k, 1);
      else net.links.push({ f: [a.l, a.i], t: [b.l, b.i], w: 1 });
      select(null);
      return;
    }
    select({ kind: "neuron", l: l, i: i });
  }

  function addNeuron(l) {
    net.layers[l].push({ bias: 0 });
    if (l === 0) net.in.push(0);
    refresh();
  }
  function removeNeuron(l) {
    if (net.layers[l].length <= 1) return;
    var i = net.layers[l].length - 1;
    net.layers[l].pop();
    if (l === 0) net.in.pop();
    net.links = net.links.filter(function (k) {
      return !((k.f[0] === l && k.f[1] === i) || (k.t[0] === l && k.t[1] === i));
    });
    sel = null;
    refresh();
  }
  function addLayer() {
    if (net.layers.length >= 5) return;
    var at = net.layers.length - 1;                    // la nouvelle couche s'insère avant la sortie
    net.layers.splice(at, 0, [{ bias: 0 }]);
    net.links = net.links.map(function (k) {
      return { f: [k.f[0] >= at ? k.f[0] + 1 : k.f[0], k.f[1]],
               t: [k.t[0] >= at ? k.t[0] + 1 : k.t[0], k.t[1]], w: k.w };
    });
    sel = null;
    refresh();
  }
  function removeLayer() {
    if (net.layers.length <= 2) return;
    var at = net.layers.length - 2;                    // on retire la dernière couche cachée
    net.layers.splice(at, 1);
    net.links = net.links.filter(function (k) { return k.f[0] !== at && k.t[0] !== at; })
      .map(function (k) {
        return { f: [k.f[0] > at ? k.f[0] - 1 : k.f[0], k.f[1]],
                 t: [k.t[0] > at ? k.t[0] - 1 : k.t[0], k.t[1]], w: k.w };
      });
    sel = null;
    refresh();
  }

  function select(s) { sel = s; refresh(); }

  function panel() {
    panelEl.innerHTML = "";
    function stepper(name, get, set) {
      var wrap = document.createElement("div");
      wrap.className = "nn-row";
      var t = document.createElement("span");
      t.className = "nn-name"; t.textContent = name;
      var minus = document.createElement("button");
      minus.type = "button"; minus.textContent = "−"; minus.setAttribute("aria-label", name + " −");
      var val = document.createElement("span");
      val.className = "nn-val"; val.textContent = fmt(get());
      var plus = document.createElement("button");
      plus.type = "button"; plus.textContent = "+"; plus.setAttribute("aria-label", name + " +");
      minus.addEventListener("click", function () { set(Math.max(-LIM, get() - STEP)); refresh(); });
      plus.addEventListener("click", function () { set(Math.min(LIM, get() + STEP)); refresh(); });
      wrap.appendChild(t); wrap.appendChild(minus); wrap.appendChild(val); wrap.appendChild(plus);
      panelEl.appendChild(wrap);
    }
    if (!sel) {
      var hint = document.createElement("p");
      hint.className = "nn-hint";
      hint.textContent = tr("Touchez un neurone pour régler son biais, puis un neurone d'une couche "
                            + "suivante pour créer ou retirer une connexion. Touchez un trait pour "
                            + "en régler le poids.",
                            "Tap a neuron to set its bias, then a neuron in a later layer to add or "
                            + "remove a connection. Tap a line to set its weight.");
      panelEl.appendChild(hint);
      return;
    }
    if (sel.kind === "neuron") {
      var n = net.layers[sel.l][sel.i];
      if (sel.l === 0) {
        stepper(tr("entrée ", "input ") + label(sel.l, sel.i),
                function () { return net.in[sel.i]; }, function (v) { net.in[sel.i] = v; });
      } else {
        stepper(tr("biais ", "bias ") + label(sel.l, sel.i),
                function () { return n.bias; }, function (v) { n.bias = v; });
      }
    } else {
      var k = net.links[sel.i];
      stepper(tr("poids ", "weight ") + label(k.f[0], k.f[1]) + " → " + label(k.t[0], k.t[1]),
              function () { return k.w; }, function (v) { k.w = v; });
      var del = document.createElement("button");
      del.type = "button"; del.className = "nn-del";
      del.textContent = tr("Supprimer la connexion", "Delete the connection");
      del.addEventListener("click", function () { net.links.splice(sel.i, 1); select(null); });
      panelEl.appendChild(del);
    }
  }

  /* ---------- entrées et table de vérité ---------- */
  function inputsBar() {
    inputsEl.innerHTML = "";
    net.layers[0].forEach(function (n, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label(0, i) + " = " + fmt(net.in[i]);
      b.addEventListener("click", function () { net.in[i] = net.in[i] ? 0 : 1; refresh(); });
      inputsEl.appendChild(b);
    });
  }

  var COMBOS = [[0, 0], [0, 1], [1, 0], [1, 1]];
  function truth() {
    tableEl.innerHTML = "";
    var last = net.layers.length - 1;
    if (net.layers[0].length !== 2 || net.layers[last].length !== 1) {
      statusEl.textContent = net.layers.map(function (L) { return L.length; }).join(" → ")
        + tr(" · défi XOR avec 2 entrées et 1 sortie", " · XOR challenge needs 2 inputs, 1 output");
      statusEl.className = "nn-status";
      return;
    }
    var head = document.createElement("div");
    head.className = "nn-trow nn-thead";
    ["x1", "x2", tr("sortie", "output"), tr("XOR attendu", "XOR target")].forEach(function (h) {
      var s = document.createElement("span"); s.textContent = h; head.appendChild(s);
    });
    tableEl.appendChild(head);
    var good = 0;
    COMBOS.forEach(function (c) {
      var out = forward(c)[last][0], want = c[0] ^ c[1], ok = (out >= 0.5 ? 1 : 0) === want;
      if (ok) good++;
      var row = document.createElement("div");
      row.className = "nn-trow" + (ok ? " ok" : " ko");
      [c[0], c[1], fmt(out), want].forEach(function (v) {
        var s = document.createElement("span"); s.textContent = v; row.appendChild(s);
      });
      row.addEventListener("click", function () { net.in = c.slice(); refresh(); });
      tableEl.appendChild(row);
    });
    statusEl.textContent = good === 4
      ? tr("Les quatre combinaisons sont bonnes : c'est un XOR.",
           "All four combinations are right: that is a XOR.")
      : tr(good + " combinaison" + (good > 1 ? "s" : "") + " sur 4 · " , good + " of 4 · ")
        + net.layers.map(function (L) { return L.length; }).join(" → ");
    statusEl.className = "nn-status" + (good === 4 ? " done" : "");
  }

  function refresh() { draw(); panel(); inputsBar(); truth(); }

  /* ---------- import et export au format du dépôt ---------- */
  function toJSON() {
    var id = function (l, i) { return "n" + l + "_" + i; };
    return {
      layers: net.layers.map(function (L, l) {
        return {
          id: "layer" + l, layer_index: l,
          type: l === 0 ? "input" : (l === net.layers.length - 1 ? "output" : "hidden"),
          neurons: L.map(function (n, i) {
            return { id: id(l, i), layer_index: l, neuron_index_in_layer: i, bias: n.bias,
                     type: l === 0 ? "input" : (l === net.layers.length - 1 ? "output" : "hidden") };
          })
        };
      }),
      connections: net.links.map(function (k, j) {
        return { id: "c" + j, source_id: id(k.f[0], k.f[1]), target_id: id(k.t[0], k.t[1]), weight: k.w };
      })
    };
  }

  function fromJSON(data) {
    var layers = data.layers.slice().sort(function (a, b) { return a.layer_index - b.layer_index; });
    var where = {};
    var built = layers.map(function (L, l) {
      return L.neurons.map(function (n, i) { where[n.id] = [l, i]; return { bias: +n.bias || 0 }; });
    });
    var links = (data.connections || []).map(function (c) {
      var f = where[c.source_id], t = where[c.target_id];
      return f && t ? { f: f, t: t, w: +c.weight || 0 } : null;
    }).filter(Boolean);
    net = { layers: built, links: links, in: built[0].map(function (_, i) { return i === 0 ? 1 : 0; }) };
    sel = null;
    refresh();
  }

  function bind(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener("click", fn);
  }
  bind("nn-layer-add", addLayer);
  bind("nn-layer-del", removeLayer);
  bind("nn-zero", function () { net = empty(); sel = null; refresh(); });
  bind("nn-solve", function () { net = xor(); sel = null; refresh(); });
  bind("nn-export", function () {
    var blob = new Blob([JSON.stringify(toJSON(), null, 4)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reseau.json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  var imp = document.getElementById("nn-import");
  if (imp) imp.addEventListener("change", function () {
    var f = imp.files && imp.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { fromJSON(JSON.parse(r.result)); } catch (e) { /* fichier illisible : on ne change rien */ }
    };
    r.readAsText(f);
    imp.value = "";
  });
  if (actSel) actSel.addEventListener("change", refresh);

  net = xor();
  refresh();
})();
