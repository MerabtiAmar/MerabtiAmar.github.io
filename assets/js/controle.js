/* Contrôle qualité jouable : le visiteur juge lui-même si une valeur extraite est justifiée
   par la fiche produit, puis découvre la valeur de référence. Fiches réelles du banc public
   (Amazon Berkeley Objects), données dans assets/data/attributs.js. */
(function () {
  "use strict";

  var D = window.ATTRQC, root = document.getElementById("qc");
  if (!D || !root) return;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  var bodyEl = document.getElementById("qc-body");
  var attrEl = document.getElementById("qc-attr");
  var scoreEl = document.getElementById("qc-score");
  var noteEl = document.getElementById("qc-note");
  var nextBtn = document.getElementById("qc-next");

  var NAMES = {
    color: tr("couleur", "colour"), material: tr("matière", "material"),
    weight_g: tr("poids", "weight"), length_cm: tr("longueur", "length"),
    width_cm: tr("largeur", "width"), height_cm: tr("hauteur", "height")
  };
  var UNITS = { weight_g: " g", length_cm: " cm", width_cm: " cm", height_cm: " cm" };

  var cards = D.cards.slice();
  for (var i = cards.length - 1; i > 0; i--) {          // ordre différent à chaque visite
    var j = Math.floor(Math.random() * (i + 1)), t = cards[i];
    cards[i] = cards[j]; cards[j] = t;
  }
  var idx = 0, answered = false;
  var score = { n: 0, ok: 0, lexical: [0, 0], numerique: [0, 0] };

  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function card() { return cards[idx % cards.length]; }
  function shown(c, v) { return v + (UNITS[c.a] || ""); }

  function updateScore() {
    if (!score.n) { scoreEl.textContent = tr("à vous de juger", "your call"); return; }
    var parts = [tr("Vous ", "You ") + score.ok + "/" + score.n];
    if (score.lexical[1]) parts.push(tr("lexical ", "lexical ") + score.lexical[0] + "/" + score.lexical[1]);
    if (score.numerique[1]) parts.push(tr("numérique ", "numeric ") + score.numerique[0] + "/" + score.numerique[1]);
    scoreEl.textContent = parts.join(" · ");
  }

  function render() {
    bodyEl.innerHTML = "";
    answered = false;
    var c = card();
    attrEl.textContent = tr("Attribut : ", "Attribute: ") + NAMES[c.a];
    el("blockquote", "sheet", c.t, bodyEl);
    var line = el("p", "extracted", null, bodyEl);
    el("span", "lab", tr("Valeur extraite", "Extracted value"), line);
    el("b", null, shown(c, c.v), line);
    el("p", "q", tr("Cette valeur est-elle justifiée par la fiche ?",
                    "Is this value supported by the listing?"), bodyEl);
    var box = el("div", "answer", null, bodyEl);
    var yes = el("button", "primary", tr("Elle est juste", "It is right"), box);
    var no = el("button", "primary", tr("Elle est fausse", "It is wrong"), box);

    function answer(guess) {
      if (answered) return;
      answered = true;
      yes.disabled = no.disabled = true;
      var youOk = guess === c.ok, fam = c.g === "lexical" ? score.lexical : score.numerique;
      score.n++; fam[1]++;
      if (youOk) { score.ok++; fam[0]++; }
      var box2 = el("div", "reveal", null, bodyEl);
      var head = el("p", "r-head", null, box2);
      el("span", "verdict " + (youOk ? "ok" : "ko"), youOk ? tr("Juste.", "Right.") : tr("Faux.", "Wrong."), head);
      el("span", "truth", c.ok ? tr("la valeur extraite est bonne", "the extracted value is correct")
                                : tr("la valeur extraite est fausse", "the extracted value is wrong"), head);
      var ul = el("ul", "models", null, box2);
      var li = el("li", null, null, ul);
      el("span", "who", tr("Extrait", "Extracted"), li);
      el("span", "what", shown(c, c.v), li);
      el("span", "verdict " + (c.ok ? "ok" : "ko"), c.ok ? tr("juste", "right") : tr("faux", "wrong"), li);
      var li2 = el("li", null, null, ul);
      el("span", "who", tr("Référence", "Reference"), li2);
      el("span", "what", shown(c, c.ref), li2);
      updateScore();
      nextBtn.focus();
    }
    yes.addEventListener("click", function () { answer(true); });
    no.addEventListener("click", function () { answer(false); });
    updateScore();
  }

  var b = D.bench;
  function group(n) {                                   // 6813 -> 6 813 (ou 6,813)
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, EN ? "," : " ");
  }
  noteEl.textContent = tr(
    "Sur le banc complet (" + group(b.n_values) + " valeurs extraites), la combinaison des signaux atteint "
    + "une AUROC de 0,66 ; l'inférence textuelle aide sur les attributs lexicaux (0,63) mais pas sur "
    + "les numériques (0,44).",
    "Over the full bench (" + group(b.n_values) + " extracted values), combining the signals reaches an AUROC "
    + "of 0.66; textual inference helps on lexical attributes (0.63) but not on numeric ones (0.44).");

  nextBtn.addEventListener("click", function () { idx++; render(); });
  render();
})();
