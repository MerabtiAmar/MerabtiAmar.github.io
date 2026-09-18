/* Carnet — comportements du site : mode de lecture, menus, filtres, tableau tactique, diagraphie du parcours. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EN = document.documentElement.lang === "en";
  function tr(fr, en) { return EN ? en : fr; }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { return null; }
    return null;
  }

  /* ---------- Mode de lecture : 30 secondes / carnet complet ---------- */
  function setupModes() {
    var buttons = document.querySelectorAll("[data-set-mode]");
    if (!buttons.length) return;
    function apply(mode, scroll) {
      document.body.setAttribute("data-mode", mode);
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-set-mode") === mode)); });
      store("carnet-mode", mode);
      if (scroll) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute("data-set-mode"), true); });
    });
    var initial = location.hash === "#30s" ? "quick" : (store("carnet-mode") || "full");
    apply(initial === "quick" ? "quick" : "full", false);
  }

  /* ---------- Menus déroulants (CV) ---------- */
  function setupMenus() {
    var menus = document.querySelectorAll("details.menu");
    document.addEventListener("click", function (e) {
      menus.forEach(function (m) { if (m.open && !m.contains(e.target)) m.open = false; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      menus.forEach(function (m) { if (m.open) { m.open = false; m.querySelector("summary").focus(); } });
    });
  }

  /* ---------- Atelier : filtres ---------- */
  function setupFilters() {
    var bar = document.querySelector(".filters");
    if (!bar) return;
    var items = document.querySelectorAll(".shelf li");
    var count = document.getElementById("shelf-count");
    bar.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      var f = btn.getAttribute("data-filter");
      bar.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      var shown = 0;
      items.forEach(function (li) {
        var ok = f === "tout" || (" " + li.getAttribute("data-tags") + " ").indexOf(" " + f + " ") >= 0;
        li.hidden = !ok;
        if (ok) shown++;
      });
      if (count) count.textContent = shown + (shown > 1 ? tr(" projets", " projects") : tr(" projet", " project"));
    });
  }

  /* ---------- Tableau tactique : matchs joués en direct par le réseau (voir football.js) ---------- */
  function setupBoard() {
    var canvas = document.getElementById("board");
    var foot = window.FOOT;
    if (!canvas || !foot || !foot.init(window.FOOT_POLICY)) return;
    var ctx = canvas.getContext("2d");
    var C = foot.config, P = window.FOOT_POLICY.pitch, dt = C.dt;
    var W = P.length + 8, H = P.width + 8; // marge de 4 m autour du terrain
    var scoreEl = document.getElementById("board-score");
    var flashEl = document.getElementById("board-flash");
    var clockEl = document.getElementById("board-clock");
    var playBtn = document.getElementById("board-play");
    var nextBtn = document.getElementById("board-next");
    var match = foot.match(), t = 0, hold = 0, goals1 = 0, goals2 = 0, draws = 0, counted = false;
    var playing = !reduceMotion, visible = true, last = 0, raf = 0, colors = {};

    /* la simulation prend de l'avance sur l'affichage : un pas de jeu coûte moins de 0,3 ms,
       soit quelques pas par image, et le match n'est jamais écrit à l'avance */
    function ensure(upto) {
      if (match.outcome !== null) return;
      var need = Math.ceil((upto - match.duration()) / dt);
      if (need > 0) match.advance(Math.min(need, 60));
    }

    function readColors() {
      colors = { ink: cssVar("--ink"), muted: cssVar("--muted"), accent: cssVar("--accent"), paper: cssVar("--paper-2"), rule: cssVar("--rule-strong") };
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * H / W * dpr);
      draw();
    }

    function tx(x) { return (x + W / 2) / W * canvas.width; }
    function ty(y) { return (H / 2 - y) / H * canvas.height; }
    function ts(m) { return m / W * canvas.width; }

    function pitch() {
      var hl = P.length / 2, hw = P.width / 2;
      ctx.fillStyle = colors.paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = colors.rule;
      ctx.lineWidth = Math.max(1, ts(0.28));
      ctx.strokeRect(tx(-hl), ty(hw), ts(P.length), ts(P.width));
      ctx.beginPath(); ctx.moveTo(tx(0), ty(hw)); ctx.lineTo(tx(0), ty(-hw)); ctx.stroke();
      ctx.beginPath(); ctx.arc(tx(0), ty(0), ts(P.circle), 0, Math.PI * 2); ctx.stroke();
      [-1, 1].forEach(function (side) {
        var x = side * hl;
        ctx.strokeRect(side < 0 ? tx(x) : tx(x - P.penalty_depth), ty(P.penalty_width / 2), ts(P.penalty_depth), ts(P.penalty_width));
        ctx.strokeRect(side < 0 ? tx(x) : tx(x - P.goal_area_depth), ty(P.goal_area_width / 2), ts(P.goal_area_depth), ts(P.goal_area_width));
        ctx.save();
        ctx.lineWidth = Math.max(1.5, ts(0.45));
        ctx.strokeStyle = side > 0 ? colors.ink : colors.accent;   // chacun défend la cage de sa couleur
        ctx.strokeRect(side < 0 ? tx(x - 2.5) : tx(x), ty(P.goal_width / 2), ts(2.5), ts(P.goal_width));
        ctx.restore();
      });
    }

    function lerpFrame(frames, f) {
      var i = Math.min(Math.floor(f), frames.length - 1), j = Math.min(i + 1, frames.length - 1), a = f - Math.floor(f);
      var A = frames[i], B = frames[j];
      return [0, 1, 2, 3, 4, 5].map(function (k) { return A[k] + (B[k] - A[k]) * (j === i ? 0 : a); }).concat([A[6]]);
    }

    function trail(frames, upto, k) {
      var from = Math.max(0, Math.floor(upto) - 18);
      ctx.beginPath();
      for (var i = from; i <= Math.floor(upto); i++) {
        var fr = frames[i];
        if (i === from) ctx.moveTo(tx(fr[k]), ty(fr[k + 1])); else ctx.lineTo(tx(fr[k]), ty(fr[k + 1]));
      }
      ctx.stroke();
    }

    function draw() {
      if (!colors.ink) readColors();
      var frames = match.frames;
      var f = Math.min(t / dt, frames.length - 1);
      pitch();
      if (!playing && reduceMotion && t === 0) f = frames.length - 1; // image fixe : trajectoire complète
      updateClock();
      var s = lerpFrame(frames, f);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1, ts(0.35));
      ctx.strokeStyle = colors.accent; trail(frames, f, 0);
      ctx.strokeStyle = colors.ink; trail(frames, f, 2);
      ctx.globalAlpha = 0.7; ctx.setLineDash([ts(0.6), ts(0.9)]); trail(frames, f, 4); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      var r = ts(2.1);
      ctx.fillStyle = colors.accent;
      ctx.beginPath(); ctx.arc(tx(s[0]), ty(s[1]), r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = colors.ink; ctx.lineWidth = Math.max(1.5, ts(0.55));
      ctx.beginPath(); ctx.arc(tx(s[2]), ty(s[3]), r - ts(0.25), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = colors.ink;
      ctx.beginPath(); ctx.arc(tx(s[4]), ty(s[5]), Math.max(3, ts(0.95)), 0, Math.PI * 2); ctx.fill();
    }

    var LABELS = {
      GOAL_PLAYER1: tr("But du joueur 1", "Goal, player 1"),
      GOAL_PLAYER2: tr("But du joueur 2", "Goal, player 2"),
      DRAW: tr("Match nul", "Draw"),
      OUT: tr("Ballon sorti", "Ball out"),
      TIMEOUT: tr("Temps écoulé", "Time up")
    };

    /* compte à rebours : 20 secondes sans but et le match est nul */
    function updateClock() {
      if (!clockEl) return;
      var left = Math.max(0, C.matchSeconds - t), s = left.toFixed(1);
      clockEl.textContent = (EN ? s : s.replace(".", ",")) + " s";
      clockEl.className = "clock" + (left <= 5 ? " low" : "");
    }

    function updateScore() {
      if (!scoreEl) return;
      scoreEl.innerHTML = "";
      var b1 = document.createElement("b"); b1.textContent = goals1;
      var b2 = document.createElement("b"); b2.textContent = goals2;
      scoreEl.append(tr("Joueur 1 ", "Player 1 "), b1, " – ", b2, tr(" joueur 2", " player 2"));
      if (draws) scoreEl.append(draws > 1 ? tr(" · " + draws + " nuls", " · " + draws + " draws")
                                         : tr(" · 1 nul", " · 1 draw"));
    }

    function step(now) {
      raf = 0;
      if (!playing || !visible) return;
      var elapsed = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      ensure(t + 1.0);
      var dur = match.duration();
      if (match.outcome === null || t < dur) {
        t = Math.min(dur, t + elapsed);
      } else {
        if (!counted) {
          counted = true;
          if (match.outcome === "GOAL_PLAYER1") goals1++;
          else if (match.outcome === "GOAL_PLAYER2") goals2++;
          else draws++;
          updateScore();
          if (flashEl) flashEl.textContent = LABELS[match.outcome] || match.outcome;
        }
        hold += elapsed;
        if (hold > 1.3) nextMatch();
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    function nextMatch() {
      match = foot.match();
      t = 0; hold = 0; counted = false;
      if (flashEl) flashEl.textContent = "";
      if (reduceMotion && !playing) match.advance(C.maxSteps + 1); // image fixe : match complet
      else ensure(0.6);
    }

    function setPlaying(p) {
      playing = p;
      if (playBtn) playBtn.textContent = p ? "Pause" : tr("Lecture", "Play");
      last = 0;
      if (p && !raf) raf = requestAnimationFrame(step);
      draw();
    }

    if (playBtn) playBtn.addEventListener("click", function () { setPlaying(!playing); });
    if (nextBtn) nextBtn.addEventListener("click", function () { nextMatch(); draw(); });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && playing && !raf) { last = 0; raf = requestAnimationFrame(step); }
      }).observe(canvas);
    }
    document.addEventListener("visibilitychange", function () {
      visible = !document.hidden;
      if (visible && playing && !raf) { last = 0; raf = requestAnimationFrame(step); }
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { readColors(); draw(); });
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);

    readColors();
    updateScore();
    if (reduceMotion && !playing) match.advance(C.maxSteps + 1); else ensure(0.6);
    resize();
    setPlaying(playing);
  }

  /* ---------- Parcours dessiné comme une diagraphie ---------- */
  var LOG = {
    start: 2020.35,
    end: 2026.95,
    samples: [2020.5, 2021, 2021.5, 2022, 2022.5, 2023, 2023.5, 2024, 2024.5, 2025, 2025.5, 2026, 2026.5],
    tracks: [
      { name: tr(["Algorithmique", "et code"], ["Algorithms", "and code"]), short: "Algo", v: [0.15, 0.45, 0.6, 0.7, 0.76, 0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.88] },
      { name: ["Machine", "learning"], short: "ML", v: [0, 0, 0.05, 0.1, 0.2, 0.5, 0.75, 0.8, 0.8, 0.82, 0.84, 0.86, 0.88] },
      { name: ["Deep", "learning"], short: "DL", v: [0, 0, 0, 0.05, 0.05, 0.2, 0.45, 0.6, 0.65, 0.8, 0.82, 0.86, 0.95] },
      { name: tr(["NLP", "et LLM"], ["NLP", "and LLMs"]), short: "NLP", v: [0, 0, 0, 0, 0.05, 0.12, 0.15, 0.25, 0.35, 0.7, 0.75, 0.9, 0.95] }
    ],
    formation: [
      { from: 2020.7, to: 2023.5, label: tr("Licence informatique", "BSc Computer Science"), place: tr("USTHB, Alger", "USTHB, Algiers"), pat: "dots" },
      { from: 2023.7, to: 2024.5, label: tr("M1 SII", "MSc 1 · SII"), place: tr("USTHB, Alger", "USTHB, Algiers"), pat: "dash" },
      { from: 2024.7, to: 2025.5, label: tr("M1 DCI", "MSc 1 · DCI"), place: "Université Paris Cité", pat: "brick" },
      { from: 2025.7, to: 2026.6, label: tr("M2 DCI · major", "MSc 2 · ranked 1st"), place: "Université Paris Cité", pat: "cross" }
    ],
    terrain: [
      { from: 2023.1, to: 2023.45, label: tr("Stage ML", "ML intern"), place: "ENAGEO" },
      { from: 2023.5, to: 2024.5, label: tr("CDD développeur IA", "AI developer"), place: "ENAGEO" },
      { from: 2026.1, to: 2026.6, label: tr("Stage data scientist", "Data science intern"), place: "Nricher" }
    ],
    events: [
      { t: 2020.45, text: tr("Bac sciences expérimentales, mention Bien", "Baccalaureate in experimental sciences, with honors") },
      { t: 2021.1, text: tr("Premiers jeux en C avec SDL", "First games in C with SDL") },
      { t: 2022.08, text: tr("Gestion de bibliothèque en C (L2)", "Library management system in C (year 2)") },
      { t: 2022.45, text: tr("Aqessar, messagerie Android en kabyle", "Aqessar, an Android chat app in Kabyle") },
      { t: 2022.95, text: tr("Compilateur Flex/Bison", "Flex/Bison compiler") },
      { t: 2023.3, text: tr("Premier modèle ML sur des diagraphies (r = 0,52)", "First ML model on well logs (r = 0.52)") },
      { t: 2024.05, text: tr("Métaheuristiques · LSTM pour le sentiment", "Metaheuristics · LSTM for sentiment") },
      { t: 2024.3, text: tr("LSTM sur diagraphies : r = 0,82 (ENAGEO)", "LSTM on well logs: r = 0.82 (ENAGEO)") },
      { t: 2024.72, text: tr("Rentrée à l'Université Paris Cité", "Start at Université Paris Cité") },
      { t: 2025.3, text: tr("Benchmark de LLM · imputation de séries", "LLM benchmark · time series imputation") },
      { t: 2025.85, text: tr("Streaming Kafka/Spark · extraction temporelle", "Kafka/Spark streaming · temporal extraction") },
      { t: 2026.2, text: tr("Mémoire : inférence textuelle + TabPFN", "Thesis: textual inference + TabPFN") },
      { t: 2026.42, text: tr("KabyLLM · agents RL", "KabyLLM · RL agents") },
      { t: 2026.78, text: tr("Octobre 2026 : thèse CIFRE ou CDI", "October 2026: CIFRE PhD or permanent role"), next: true }
    ]
  };

  function setupLog() {
    var svg = document.getElementById("log");
    var wrap = svg && svg.closest(".log-wrap");
    var tip = document.getElementById("log-tip");
    var bar = document.getElementById("log-cols"); // en-têtes de colonnes, collants au défilement
    if (!svg || !wrap || !tip) return;
    var NS = "http://www.w3.org/2000/svg";
    var geo = null, cursorT = null;
    var hint = document.getElementById("log-hint"), deskHint = hint ? hint.textContent : "";
    // Défilement par étapes des écrans étroits : la diagraphie est dessinée en entier, plus large
    // que l'écran, et se déplace toute seule d'un bloc de lecture au suivant.
    var panMode = false, pan = 0, maxPan = 0, frozen = [], stations = [0], stIdx = 0;
    var timer = 0, raf = 0, dragging = false, inView = false, touched = false;

    function el(name, attrs, parent, text) {
      var n = document.createElementNS(NS, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      if (parent) parent.appendChild(n);
      return n;
    }

    function smoothPath(pts) {
      var d = "M" + pts[0][0] + "," + pts[0][1];
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
        var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += " C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
      }
      return d;
    }

    var renderedWidth = 0;
    function render() {
      var vis = wrap.clientWidth;
      if (!vis || vis === renderedWidth) return;
      renderedWidth = vis;
      stop();
      panMode = vis < 880;               // sous 880 px : même dessin, mais il défile
      var gap = 8, head = 14, ppy = panMode ? 96 : 112;
      var depthW = panMode ? 46 : 56, formW, terrW, trackW, eventsW, Wd;
      if (panMode) {
        var avail = vis - depthW - gap - 2;   // une étape de lecture = une largeur d'écran
        formW = Math.round(avail * 0.52); terrW = avail - formW - gap;
        trackW = Math.floor((avail - 3 * gap) / 4);
        eventsW = avail;
        Wd = depthW + gap + formW + gap + terrW + gap + 4 * trackW + 4 * gap + eventsW;
      } else {
        formW = 168; terrW = 132;
        eventsW = Math.max(220, vis - depthW - formW - terrW - 4 * 96 - 6 * gap);
        trackW = Math.max(44, (vis - depthW - formW - terrW - eventsW - 6 * gap) / 4);
        Wd = vis;
      }
      var Hd = head + (LOG.end - LOG.start) * ppy + 14;
      maxPan = Math.max(0, Wd - vis);
      pan = 0; stIdx = 0; frozen = [];
      svg.setAttribute("height", Hd);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      function y(t) { return head + (t - LOG.start) * ppy; }
      var x0 = depthW + gap, xForm = x0, xTerr = xForm + formW + gap, xTracks = xTerr + terrW + gap;
      var xEvents = xTracks + 4 * trackW + 4 * gap;
      geo = { y: y, head: head, ppy: ppy, Wd: vis, Hd: Hd, x0: x0, total: Wd };
      stations = panMode ? [0, Math.min(maxPan, xTracks - x0), maxPan] : [0];

      var ink = "var(--ink)", ink2 = "var(--ink-2)", muted = "var(--muted)", rule = "var(--rule)", accent = "var(--accent)";
      var defs = el("defs", {}, svg);
      var p;
      p = el("pattern", { id: "p-dots", width: 7, height: 7, patternUnits: "userSpaceOnUse" }, defs);
      el("circle", { cx: 3.5, cy: 3.5, r: 1 }, p).style.fill = ink2;
      p = el("pattern", { id: "p-dash", width: 14, height: 8, patternUnits: "userSpaceOnUse" }, defs);
      el("line", { x1: 1, y1: 4, x2: 9, y2: 4 }, p).style.stroke = ink2;
      p = el("pattern", { id: "p-brick", width: 16, height: 10, patternUnits: "userSpaceOnUse" }, defs);
      el("path", { d: "M0,0.5 H16 M0,5.5 H16 M4,0.5 V5.5 M12,5.5 V10", fill: "none" }, p).style.stroke = ink2;
      p = el("pattern", { id: "p-cross", width: 9, height: 9, patternUnits: "userSpaceOnUse" }, defs);
      el("path", { d: "M0,0 L9,9 M9,0 L0,9", fill: "none" }, p).style.stroke = ink2;

      var g = el("g", {}, svg);
      // En-têtes de colonnes : placés en HTML au-dessus du dessin, pour rester visibles pendant le défilement
      if (bar) while (bar.firstChild) bar.removeChild(bar.firstChild);
      function header(x, w, title, sub, fixed) {
        if (!bar) return;
        var s = document.createElement("span");
        s.setAttribute("data-x", x);
        if (fixed) s.className = "fixed";          // la colonne des années ne défile pas
        s.style.left = x + "px";
        s.style.width = w + "px";
        s.textContent = title;
        if (sub) { s.appendChild(document.createElement("br")); s.appendChild(document.createTextNode(sub)); }
        bar.appendChild(s);
      }
      header(xForm, formW, tr("Formation", "Education"));
      header(xTerr, terrW, tr("Terrain", "Industry"));
      LOG.tracks.forEach(function (track, i) {
        if (trackW >= 96) header(xTracks + i * (trackW + gap), trackW, track.name[0], track.name[1]);
        else header(xTracks + i * (trackW + gap), trackW, track.short);
      });
      header(xEvents, eventsW, tr("Faits marquants", "Milestones"));
      header(0, depthW, tr("Année", "Year"), null, true);

      // Graduations annuelles
      for (var yr = Math.ceil(LOG.start); yr <= Math.floor(LOG.end); yr++) {
        var gl = el("line", { x1: x0, x2: Wd, y1: y(yr), y2: y(yr) }, g); gl.style.stroke = rule;
      }

      // Formation
      LOG.formation.forEach(function (f) {
        var r = el("rect", { x: xForm, y: y(f.from), width: formW, height: y(f.to) - y(f.from), fill: "url(#p-" + f.pat + ")" }, g);
        r.style.stroke = "var(--rule-strong)"; r.style.opacity = 0.9;
        var tw = Math.min(formW - 10, 8.2 * Math.max(f.label.length, f.place.length * 0.86));
        var bg = el("rect", { x: xForm + 5, y: y(f.from) + 6, width: tw, height: 34 }, g); bg.style.fill = "var(--paper-2)";
        el("text", { x: xForm + 9, y: y(f.from) + 20, "font-size": 12 }, g, f.label).style.fill = ink;
        el("text", { x: xForm + 9, y: y(f.from) + 34, "font-size": 10.5 }, g, f.place).style.fill = muted;
      });

      // Terrain (entreprises)
      LOG.terrain.forEach(function (f) {
        var r = el("rect", { x: xTerr, y: y(f.from), width: terrW, height: y(f.to) - y(f.from) }, g);
        r.style.fill = "var(--accent-soft)";
        var edge = el("rect", { x: xTerr, y: y(f.from), width: 3, height: y(f.to) - y(f.from) }, g); edge.style.fill = accent;
        el("text", { x: xTerr + 10, y: y(f.from) + 16, "font-size": 12 }, g, f.place).style.fill = ink;
        if (y(f.to) - y(f.from) > 34) el("text", { x: xTerr + 10, y: y(f.from) + 30, "font-size": panMode ? 9.5 : 10.5 }, g, f.label).style.fill = muted;
      });

      // Courbes de compétences
      LOG.tracks.forEach(function (tr, i) {
        var xl = xTracks + i * (trackW + gap), pad = 4, span = trackW - 2 * pad;
        var frame = el("rect", { x: xl, y: head, width: trackW, height: y(LOG.end) - head, fill: "none" }, g); frame.style.stroke = rule;
        var mid = el("line", { x1: xl + trackW / 2, x2: xl + trackW / 2, y1: head, y2: y(LOG.end) }, g); mid.style.stroke = rule; mid.style.opacity = 0.6;
        var pts = LOG.samples.map(function (t, k) { return [xl + pad + tr.v[k] * span, y(t)]; });
        pts.unshift([xl + pad, y(LOG.start + 0.05)]);
        pts.push([xl + pad + tr.v[tr.v.length - 1] * span, y(LOG.end - 0.05)]);
        var line = smoothPath(pts);
        var area = el("path", { d: line + " L" + (xl + pad) + "," + y(LOG.end - 0.05) + " L" + (xl + pad) + "," + y(LOG.start + 0.05) + " Z" }, g);
        area.style.fill = "var(--accent-wash)";
        var stroke = el("path", { d: line, fill: "none", "stroke-width": 1.6, "stroke-linejoin": "round" }, g); stroke.style.stroke = ink;
      });

      // Faits marquants
      if (eventsW) {
        var lastY = -1e9, maxChars = Math.max(18, Math.floor((eventsW - 18) / 7.3));
        LOG.events.forEach(function (ev) {
          var lines = [], cur = "";
          ev.text.split(" ").forEach(function (w) {
            if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; } else { cur = cur ? cur + " " + w : w; }
          });
          lines.push(cur);
          var yy = Math.max(y(ev.t), lastY + 19);
          lastY = yy + (lines.length - 1) * 15;
          var tick = el("line", { x1: xEvents - gap, x2: xEvents + 8, y1: y(ev.t), y2: yy }, g); tick.style.stroke = ev.next ? accent : "var(--rule-strong)";
          var tt = el("text", { x: xEvents + 14, y: yy + 4, "font-size": 12 }, g);
          tt.style.fill = ev.next ? accent : ink2;
          lines.forEach(function (ln, k) { el("tspan", { x: xEvents + 14, dy: k ? 15 : 0 }, tt, ln); });
        });
      }
      // Prochain forage
      var nx = el("line", { x1: x0, x2: xEvents - gap, y1: y(2026.78), y2: y(2026.78), "stroke-width": 1.5 }, g); nx.style.stroke = accent;

      // Colonne des années : elle reste en place pendant que le reste défile
      var gy = el("g", {}, svg);
      el("rect", { x: 0, y: 0, width: depthW, height: Hd }, gy).style.fill = "var(--paper-2)";
      for (var yr2 = Math.ceil(LOG.start); yr2 <= Math.floor(LOG.end); yr2++) {
        el("text", { x: depthW - 6, y: y(yr2) + 4, "font-size": 12.5, "text-anchor": "end" }, gy,
           String(yr2)).style.fill = ink2;
      }
      frozen.push(gy);

      // Curseur
      var cur = el("g", { id: "log-cursor", visibility: "hidden" }, svg);
      var cl = el("line", { x1: 0, x2: Wd, y1: 0, y2: 0, "stroke-width": 1 }, cur); cl.style.stroke = ink;
      var cbadge = el("g", {}, cur);
      var cb = el("rect", { x: 0, y: -10, width: depthW - 2, height: 20, rx: 2 }, cbadge); cb.style.fill = ink;
      var ct = el("text", { x: depthW - 6, y: 4, "font-size": 11.5, "text-anchor": "end" }, cbadge, ""); ct.style.fill = "var(--paper)";
      geo.cursor = { g: cur, text: ct };
      frozen.push(cbadge);

      applyPan();
      setHint();
      cycle();
      if (cursorT !== null) show(cursorT);
    }

    /* ---- Déplacement horizontal : trois étapes de lecture sur écran étroit ---- */
    var STATIONS = [tr("Formation et terrain", "Education and industry"),
                    tr("Compétences", "Skills"), tr("Faits marquants", "Milestones")];

    function applyPan() {
      if (!geo) return;
      svg.setAttribute("viewBox", pan.toFixed(1) + " 0 " + geo.Wd + " " + geo.Hd);
      frozen.forEach(function (n) { n.setAttribute("transform", "translate(" + pan.toFixed(1) + ",0)"); });
      if (!bar) return;
      for (var i = 0; i < bar.children.length; i++) {
        var s = bar.children[i], x = parseFloat(s.getAttribute("data-x"));
        s.style.left = (s.className === "fixed" ? x : x - pan) + "px";
      }
    }

    function setHint() {
      if (!hint) return;
      if (!panMode) { hint.textContent = deskHint; return; }
      hint.textContent = (stIdx + 1) + "/" + stations.length + " · " + STATIONS[stIdx]
        + (touched ? "" : tr(" · glissez", " · swipe"));
    }

    function stop() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    function glide(to, ms, then) {
      var from = pan, t0 = 0;
      (function frame(now) {
        if (!t0) t0 = now || performance.now();
        var k = Math.min(1, ((now || performance.now()) - t0) / ms);
        var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        pan = from + (to - from) * e;
        applyPan();
        if (k < 1) raf = requestAnimationFrame(frame);
        else { raf = 0; if (then) then(); }
      })(0);
    }

    function cycle() {
      stop();
      if (!panMode || reduceMotion || !inView || dragging || maxPan <= 0) return;
      // l'étape des faits marquants contient beaucoup de texte : on y laisse plus de temps
      timer = setTimeout(function () {
        timer = 0;
        var next = (stIdx + 1) % stations.length;
        stIdx = next;
        setHint();
        hide();
        glide(stations[next], next === 0 ? 900 : 700, cycle);
      }, stIdx === stations.length - 1 ? 6500 : 4200);
    }

    function resumeLater(delay) {
      stop();
      if (!panMode || reduceMotion) return;
      timer = setTimeout(function () {
        timer = 0;
        var best = 0;
        stations.forEach(function (s, i) { if (Math.abs(s - pan) < Math.abs(stations[best] - pan)) best = i; });
        stIdx = best;
        setHint();
        glide(stations[best], 400, cycle);
      }, delay);
    }

    var dragX = 0, dragPan = 0, moved = 0;
    svg.addEventListener("pointerdown", function (e) {
      if (!panMode || maxPan <= 0) return;
      dragging = true; moved = 0; dragX = e.clientX; dragPan = pan;
      stop();
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* sans capture, le glissement marche quand même */ }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - dragX;
      moved = Math.max(moved, Math.abs(dx));
      pan = Math.max(0, Math.min(maxPan, dragPan - dx));
      applyPan();
      if (moved > 4 && !touched) { touched = true; setHint(); }
      if (moved > 4) hide();
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (moved <= 4 && geo && e.pointerType !== "mouse") {      // simple appui : lire une année
        var r = svg.getBoundingClientRect();
        var yv = (e.clientY - r.top) / r.height * geo.Hd;
        if (yv > geo.head) show(Math.round((LOG.start + (yv - geo.head) / geo.ppy) * 8) / 8);
      }
      resumeLater(moved > 4 ? 2500 : 6000);
    }
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView) cycle(); else stop();
      }, { threshold: 0.12 }).observe(wrap);
    } else {
      inView = true;
    }

    // Niveau d'études : l'année universitaire commence en septembre ;
    // 1er semestre de septembre à janvier, 2e de février à juin.
    var LEVELS = EN ? {
      2020: { name: "Bachelor's year 1", s: ["semester 1 (S1)", "semester 2 (S2)"] },
      2021: { name: "Bachelor's year 2", s: ["semester 3 (S3)", "semester 4 (S4)"] },
      2022: { name: "Bachelor's year 3", s: ["semester 5 (S5)", "semester 6 (S6)"] },
      2023: { name: "Master's year 1 (SII)", s: ["semester 7 (S7)", "semester 8 (S8)"] },
      2024: { name: "Master's year 1 (DCI)", s: ["1st semester", "2nd semester"] },
      2025: { name: "Master's year 2 (DCI)", s: ["1st semester", "2nd semester"] }
    } : {
      2020: { name: "Licence 1", s: ["semestre 1 (S1)", "semestre 2 (S2)"] },
      2021: { name: "Licence 2", s: ["semestre 3 (S3)", "semestre 4 (S4)"] },
      2022: { name: "Licence 3", s: ["semestre 5 (S5)", "semestre 6 (S6)"] },
      2023: { name: "Master 1 SII", s: ["semestre 7 (S7)", "semestre 8 (S8)"] },
      2024: { name: "Master 1 DCI", s: ["1er semestre", "2e semestre"] },
      2025: { name: "Master 2 DCI", s: ["1er semestre", "2e semestre"] }
    };

    function academic(t) {
      var yr = Math.floor(t), month = Math.min(12, Math.floor((t - yr) * 12) + 1);
      if (month === 7 || month === 8) {
        var before = LEVELS[yr - 1];
        if (EN) return { title: "Summer " + yr, sub: before ? "after " + before.name : "" };
        return { title: "Été " + yr, sub: before ? (before.name.indexOf("Licence") === 0 ? "après la " : "après le ") + before.name : "" };
      }
      var start = month >= 9 ? yr : yr - 1;
      if (start < 2020) return { title: tr("Terminale · baccalauréat", "Final year of high school"), sub: tr("juin 2020", "baccalaureate, June 2020") };
      if (start > 2025) return { title: tr("Rentrée ", "Autumn ") + yr, sub: tr("après le master : thèse CIFRE ou CDI", "after the master's: CIFRE PhD or permanent role") };
      var sem = (month >= 9 || month === 1) ? 0 : 1;
      return { title: LEVELS[start].name + " · " + LEVELS[start].s[sem], sub: tr("année universitaire ", "academic year ") + start + "–" + (start + 1) };
    }

    function describe(t) {
      var ac = academic(t);
      var where = [];
      LOG.formation.concat(LOG.terrain).forEach(function (f) { if (t >= f.from - 0.05 && t <= f.to + 0.05) where.push(f.label + " — " + f.place); });
      var evs = LOG.events.filter(function (e) { return Math.abs(e.t - t) <= 0.26; }).map(function (e) { return e.text; });
      return { title: ac.title, sub: ac.sub, where: where, events: evs };
    }

    function show(t) {
      if (!geo) return;
      cursorT = Math.max(LOG.start + 0.1, Math.min(LOG.end - 0.1, t));
      var yy = geo.y(cursorT);
      geo.cursor.g.setAttribute("visibility", "visible");
      geo.cursor.g.setAttribute("transform", "translate(0," + yy.toFixed(1) + ")");
      geo.cursor.text.textContent = String(Math.floor(cursorT));
      var info = describe(cursorT);
      tip.innerHTML = "";
      var h = document.createElement("div"); h.className = "t-year"; h.textContent = info.title; tip.appendChild(h);
      if (info.sub) { var sb = document.createElement("div"); sb.className = "t-sub"; sb.textContent = info.sub; tip.appendChild(sb); }
      info.where.forEach(function (w) { var d = document.createElement("div"); d.className = "t-where"; d.textContent = w; tip.appendChild(d); });
      if (info.events.length) {
        var ul = document.createElement("ul");
        info.events.forEach(function (e) { var li = document.createElement("li"); li.textContent = e; ul.appendChild(li); });
        tip.appendChild(ul);
      }
      tip.hidden = false;
      var sr = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      var scale = sr.width / geo.Wd, svgTop = sr.top - wr.top;
      var top = svgTop + yy * scale + 14;
      var left = Math.min(wrap.clientWidth - tip.offsetWidth - 10, Math.max(10, geo.x0 * scale + 60));
      if (top + tip.offsetHeight > wrap.clientHeight - 8) top = svgTop + yy * scale - tip.offsetHeight - 14;
      tip.style.top = top + "px";
      tip.style.left = left + "px";
    }

    function hide() {
      cursorT = null;
      tip.hidden = true;
      if (geo) geo.cursor.g.setAttribute("visibility", "hidden");
    }

    svg.addEventListener("pointermove", function (e) {
      if (!geo || dragging || e.pointerType === "touch") return;   // au doigt, l'infobulle vient d'un appui
      var r = svg.getBoundingClientRect();
      var yv = (e.clientY - r.top) / r.height * geo.Hd;
      if (yv < geo.head) { hide(); return; }
      show(Math.round((LOG.start + (yv - geo.head) / geo.ppy) * 8) / 8);
    });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", function () { show(cursorT === null ? 2020.75 : cursorT); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") { if (e.key === "Escape") hide(); return; }
      e.preventDefault();
      show((cursorT === null ? 2020.75 : cursorT) + (e.key === "ArrowDown" ? 0.25 : -0.25));
    });

    if ("ResizeObserver" in window) new ResizeObserver(render).observe(wrap); else window.addEventListener("resize", render);
    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupModes();
    setupMenus();
    setupFilters();
    setupBoard();
    setupLog();
  });
})();
