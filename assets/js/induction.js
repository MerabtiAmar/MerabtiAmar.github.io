/* Transformer minuscule exécuté dans la page : propagation avant complète, cartes d'attention
   de chaque tête, et ablation d'une tête au clic. Port de model.py (dépôt
   tiny-transformer-induction) ; poids dans assets/data/induction.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TINY = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var M = null;

  function unbase64(s) {
    if (typeof atob === "function") {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return out;
    }
    return new Uint8Array(Buffer.from(s, "base64"));
  }

  function half2float(h) {
    var s = (h & 0x8000) ? -1 : 1, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
    if (e === 0) return s * 5.9604644775390625e-8 * f;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  function decode(b64, n) {
    var b = unbase64(b64), out = new Float32Array(n);
    for (var k = 0; k < n; k++) out[k] = half2float(b[2 * k] | (b[2 * k + 1] << 8));
    return out;
  }

  /* erf, pour reproduire le GELU exact de PyTorch (et non son approximation tanh) */
  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
                 + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function gelu(x) { return 0.5 * x * (1 + erf(x / Math.SQRT2)); }

  function init(data) {
    if (M) return true;
    if (!data || !data.w) return false;
    var c = data.config, d = c.d_model, L = c.n_layers, H = c.n_heads, dm = c.d_mlp;
    var w = decode(data.w, data.n), p = 0;
    function take(len) { var a = w.subarray(p, p + len); p += len; return a; }
    M = { cfg: c, tok: take(c.vocab * d), pos: take(c.seq_len * d), blocks: [], meta: data };
    for (var l = 0; l < L; l++) {
      M.blocks.push({
        g1: take(d), b1: take(d),
        q: take(d * d), k: take(d * d), v: take(d * d), o: take(d * d),
        g2: take(d), b2: take(d),
        w1: take(dm * d), c1: take(dm), w2: take(d * dm), c2: take(d)
      });
    }
    M.gf = take(d); M.bf = take(d); M.head = take(c.vocab * d);
    return true;
  }

  function layernorm(x, g, b, d) {
    var m = 0, i;
    for (i = 0; i < d; i++) m += x[i];
    m /= d;
    var v = 0;
    for (i = 0; i < d; i++) { var e = x[i] - m; v += e * e; }
    v = 1 / Math.sqrt(v / d + 1e-5);
    var out = new Float32Array(d);
    for (i = 0; i < d; i++) out[i] = (x[i] - m) * v * g[i] + b[i];
    return out;
  }

  function matvec(W, x, nOut, nIn, bias) {           // W est [nOut, nIn], rangée par rangée
    var out = new Float32Array(nOut);
    for (var o = 0, base = 0; o < nOut; o++, base += nIn) {
      var s = bias ? bias[o] : 0;
      for (var i = 0; i < nIn; i++) s += W[base + i] * x[i];
      out[o] = s;
    }
    return out;
  }

  /* tokens : tableau d'entiers ; ablate : liste de [couche, tête] à couper.
     Renvoie les logits de chaque position et les attentions [couche][tête][i][j]. */
  function forward(tokens, ablate) {
    var c = M.cfg, d = c.d_model, H = c.n_heads, dh = d / H, T = tokens.length;
    var x = [], i, j, h, l;
    for (i = 0; i < T; i++) {
      var row = new Float32Array(d);
      for (j = 0; j < d; j++) row[j] = M.tok[tokens[i] * d + j] + M.pos[i * d + j];
      x.push(row);
    }
    var atts = [];
    for (l = 0; l < c.n_layers; l++) {
      var B = M.blocks[l];
      var normed = x.map(function (r) { return layernorm(r, B.g1, B.b1, d); });
      var q = normed.map(function (r) { return matvec(B.q, r, d, d); });
      var k = normed.map(function (r) { return matvec(B.k, r, d, d); });
      var v = normed.map(function (r) { return matvec(B.v, r, d, d); });
      var attL = [];
      var heads = [];
      for (h = 0; h < H; h++) {
        var A = [];
        for (i = 0; i < T; i++) {
          var scores = new Float32Array(i + 1), max = -Infinity;
          for (j = 0; j <= i; j++) {
            var s = 0;
            for (var t = 0; t < dh; t++) s += q[i][h * dh + t] * k[j][h * dh + t];
            s /= Math.sqrt(dh);
            scores[j] = s;
            if (s > max) max = s;
          }
          var z = 0;
          for (j = 0; j <= i; j++) { scores[j] = Math.exp(scores[j] - max); z += scores[j]; }
          for (j = 0; j <= i; j++) scores[j] /= z;
          A.push(scores);
        }
        attL.push(A);
        heads.push(A);
      }
      atts.push(attL);
      // sortie de l'attention, tête par tête (une tête coupée ne contribue pas)
      var concat = [];
      for (i = 0; i < T; i++) concat.push(new Float32Array(d));
      for (h = 0; h < H; h++) {
        var off = (ablate || []).some(function (a) { return a[0] === l && a[1] === h; });
        if (off) continue;
        for (i = 0; i < T; i++) {
          for (j = 0; j <= i; j++) {
            var a = heads[h][i][j];
            if (!a) continue;
            for (var u = 0; u < dh; u++) concat[i][h * dh + u] += a * v[j][h * dh + u];
          }
        }
      }
      for (i = 0; i < T; i++) {
        var proj = matvec(B.o, concat[i], d, d);
        for (j = 0; j < d; j++) x[i][j] += proj[j];
        var n2 = layernorm(x[i], B.g2, B.b2, d);
        var hid = matvec(B.w1, n2, c.d_mlp, d, B.c1);
        for (j = 0; j < c.d_mlp; j++) hid[j] = gelu(hid[j]);
        var back = matvec(B.w2, hid, d, c.d_mlp, B.c2);
        for (j = 0; j < d; j++) x[i][j] += back[j];
      }
    }
    var logits = x.map(function (r) { return matvec(M.head, layernorm(r, M.gf, M.bf, d), c.vocab, d); });
    return { logits: logits, attentions: atts };
  }

  function softmax(v) {
    var m = -Infinity, i;
    for (i = 0; i < v.length; i++) if (v[i] > m) m = v[i];
    var out = new Float32Array(v.length), z = 0;
    for (i = 0; i < v.length; i++) { out[i] = Math.exp(v[i] - m); z += out[i]; }
    for (i = 0; i < v.length; i++) out[i] /= z;
    return out;
  }

  return { init: init, ready: function () { return !!M; }, forward: forward, softmax: softmax,
           model: function () { return M; } };
});
