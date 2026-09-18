/* Banc d'essai jouable : le visiteur répond aux mêmes questions que les trois modèles,
   puis découvre ce qu'ils avaient répondu. Rien n'est calculé ici : les réponses des modèles
   viennent des exécutions enregistrées du dépôt llm-benchmark (assets/data/benchmark.js). */
(function () {
  "use strict";

  var B = window.BENCH, root = document.getElementById("quiz");
  if (!B || !root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var bodyEl = document.getElementById("quiz-body");
  var scoreEl = document.getElementById("quiz-score");
  var noteEl = document.getElementById("quiz-note");
  var nextBtn = document.getElementById("quiz-next");
  var tabs = [].slice.call(root.querySelectorAll("[data-test]"));

  var ROWS = { gsm8k: B.gsm8k, hellaswag: B.hellaswag, humaneval: B.humaneval };
  var test = "gsm8k", idx = 0, answered = false;
  var tally = {};
  Object.keys(ROWS).forEach(function (k) { tally[k] = { you: 0, m: [0, 0, 0], n: 0 }; });

  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function row() { return ROWS[test][idx % ROWS[test].length]; }

  /* ---------- score et rappel du banc complet ---------- */
  function updateScore() {
    var t = tally[test];
    scoreEl.textContent = "";
    if (!t.n) { scoreEl.textContent = tr("à vous de jouer", "your turn"); return; }
    var parts = [tr("Vous ", "You ") + t.you + "/" + t.n];
    if (test !== "humaneval") {
      B.models.map(function (name, k) { return { name: name, v: t.m[k] }; })
        .sort(function (a, b) { return b.v - a.v; })
        .forEach(function (m) { parts.push(m.name + " " + m.v + "/" + t.n); });
    }
    scoreEl.textContent = parts.join(" · ");
  }

  function note() {
    var full = B.full[test], total = B.totals[test];
    var ranked = B.models.map(function (name, k) { return name + " " + full[k]; })
      .sort(function (a, b) { return parseInt(b.split(" ").pop(), 10) - parseInt(a.split(" ").pop(), 10); });
    var head = test === "humaneval"
      ? tr("Sur les " + total + " problèmes du banc complet : ", "Over the full benchmark of " + total + " problems: ")
      : tr("Sur les " + total + " questions du banc complet : ", "Over the full benchmark of " + total + " questions: ");
    noteEl.textContent = head + ranked.join(", ") + ".";
  }

  /* ---------- révélation commune ---------- */
  // la police embarquée n'a pas les coches : on écrit les verdicts en toutes lettres
  function verdict(parent, ok, big) {
    var word = big ? (ok ? tr("Juste.", "Right.") : tr("Faux.", "Wrong."))
                   : (ok ? tr("juste", "right") : tr("faux", "wrong"));
    return el("span", "verdict " + (ok ? "ok" : "ko"), word, parent);
  }

  function reveal(youOk, lines, title) {
    answered = true;
    var box = el("div", "reveal", null, bodyEl);
    var head = el("p", "r-head", null, box);
    verdict(head, youOk, true);
    if (title) el("span", "truth", title, head);
    var ul = el("ul", "models", null, box);
    lines.forEach(function (l) {
      var li = el("li", null, null, ul);
      el("span", "who", l.who, li);
      el("span", "what", l.what, li);
      if (l.ok !== null) verdict(li, l.ok);
    });
    nextBtn.disabled = false;
    nextBtn.focus();
    updateScore();
  }

  /* ---------- une épreuve = une façon de répondre ---------- */
  function renderMaths() {
    var r = row();
    el("p", "q", r.q, bodyEl);
    var form = el("form", "answer", null, bodyEl);
    var input = el("input", null, null, form);
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.placeholder = tr("votre réponse, en chiffres", "your answer, in digits");
    input.setAttribute("aria-label", tr("votre réponse", "your answer"));
    var send = el("button", "primary", tr("Valider", "Check"), form);
    send.type = "submit";
    var skip = el("button", "ghost", tr("Je passe", "Skip"), form);
    skip.type = "button";

    function answer(value) {
      if (answered) return;
      var youOk = value !== null && Math.abs(value - r.a) < 1e-6;
      var t = tally[test];
      t.n++; if (youOk) t.you++;
      var lines = B.models.map(function (name, k) {
        var a = r.m[k], ok = a !== null && Math.abs(a - r.a) < 1e-6;
        if (ok) t.m[k]++;
        return { who: name, what: a === null ? tr("pas de réponse exploitable", "no usable answer") : String(a), ok: ok };
      });
      input.disabled = send.disabled = skip.disabled = true;
      reveal(youOk, lines, tr("La bonne réponse est ", "The right answer is ") + r.a);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = parseFloat(String(input.value).replace(",", "."));
      answer(isNaN(v) ? null : v);
    });
    skip.addEventListener("click", function () { answer(null); });
    input.focus();
  }

  function renderCommon() {
    var r = row();
    el("p", "q", r.c + " …", bodyEl);
    var list = el("div", "choices", null, bodyEl);
    var buttons = r.e.map(function (text, k) {
      var b = el("button", "choice", null, list);
      el("span", "letter", "ABCD".charAt(k), b);
      el("span", null, text, b);
      b.addEventListener("click", function () { answer(k, buttons); });
      return b;
    });

    function answer(pick, buttons) {
      if (answered) return;
      var youOk = pick === r.t, t = tally[test];
      t.n++; if (youOk) t.you++;
      buttons.forEach(function (b, k) {
        b.disabled = true;
        if (k === r.t) b.className = "choice truth";
        else if (k === pick) b.className = "choice wrong";
      });
      var lines = B.models.map(function (name, k) {
        var p = r.m[k], ok = p === r.t;
        if (ok) t.m[k]++;
        return { who: name, what: p >= 0 ? "ABCD".charAt(p) : "—", ok: ok };
      });
      reveal(youOk, lines, tr("La suite du texte est ", "The real ending is ") + "ABCD".charAt(r.t));
    }
  }

  function renderCode() {
    var r = row();
    el("p", "q", tr("Ce code passe-t-il les tests unitaires du problème ?",
                    "Does this code pass the unit tests of the problem?"), bodyEl);
    el("pre", "prompt", r.p, bodyEl);
    el("pre", "code", r.code, bodyEl);
    var list = el("div", "answer", null, bodyEl);
    var yes = el("button", "primary", tr("Il passe", "It passes"), list);
    var no = el("button", "primary", tr("Il échoue", "It fails"), list);

    function answer(guess) {
      if (answered) return;
      var youOk = guess === r.ok;
      var t = tally[test];
      t.n++; if (youOk) t.you++;
      yes.disabled = no.disabled = true;
      var lines = [{
        who: tr("Tests", "Tests"),
        what: r.ok ? tr("le code passe", "the code passes") : tr("le code échoue", "the code fails"),
        ok: r.ok
      }, {
        who: tr("Auteur", "Author"), what: B.models[r.model], ok: null
      }];
      if (!r.ok && r.err) lines.push({ who: tr("Erreur", "Error"), what: r.err, ok: null });
      reveal(youOk, lines, tr("Fonction ", "Function ") + r.fn + "()");
    }
    yes.addEventListener("click", function () { answer(true); });
    no.addEventListener("click", function () { answer(false); });
  }

  function render() {
    bodyEl.innerHTML = "";
    answered = false;
    nextBtn.disabled = false;
    if (test === "gsm8k") renderMaths();
    else if (test === "hellaswag") renderCommon();
    else renderCode();
    updateScore();
    note();
  }

  tabs.forEach(function (b) {
    b.addEventListener("click", function () {
      test = b.getAttribute("data-test");
      idx = 0;
      tabs.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      render();
    });
  });
  nextBtn.addEventListener("click", function () { idx++; render(); });

  render();
})();
