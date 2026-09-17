/* Moteur de football v2 et politique PPO, portés en JavaScript : les matchs du tableau
   tactique sont joués ici, dans le navigateur, un pas de temps après l'autre.
   Port fidèle de football/match.py, football/obs2.py et football/policy2.py
   (dépôt rl-football-selfplay) ; les poids viennent de assets/data/politique.js. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FOOT = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- configuration du moteur (miroir de MatchConfig) ---------- */
  var C = {
    dt: 0.1, matchSeconds: 20.0, maxSteps: 200,
    xMax: 52.5, yMax: 34.0, goalHalf: 3.66,
    maxSpeed: 7.0, sprintMult: 1.4, carrierMult: 0.85, accel: 15.0,
    radius: 1.0, collIters: 2,
    damping: 0.965, kickSpeed: [12.0, 22.0], passSpeed: [10.0, 16.0],
    possR: 1.6, controlSpeed: 12.0, dribble: 1.1, kickCool: 4,
    tackleR: 2.3, tackleP: 0.25, graceSteps: 6,
    restartSteps: 30, inset: 0.5,
    spawnMix: [0.4, 0.3, 0.3], margin: 4.0, centreHalf: 10.0
  };
  var N_MOVE = 16, N_KICK = 24;
  var DIRS_MOVE = [], DIRS_KICK = [], i;
  for (i = 0; i < N_MOVE; i++) DIRS_MOVE.push([Math.cos(i * 2 * Math.PI / N_MOVE), Math.sin(i * 2 * Math.PI / N_MOVE)]);
  for (i = 0; i < N_KICK; i++) DIRS_KICK.push([Math.cos(i * 2 * Math.PI / N_KICK), Math.sin(i * 2 * Math.PI / N_KICK)]);
  var PLAYING = 0, GOAL_P1 = 1, GOAL_P2 = 2, DRAW = 3;
  var OUTCOMES = { 1: "GOAL_PLAYER1", 2: "GOAL_PLAYER2", 3: "DRAW" };

  /* ---------- politique : float16 en base64 -> deux couches tanh puis les têtes ---------- */
  var net = null;

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
    if (e === 0) return s * 5.9604644775390625e-8 * f;          // dénormalisés : 2^-24 * f
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  function decode(b64, n) {
    var bytes = unbase64(b64), out = new Float32Array(n);
    for (var k = 0; k < n; k++) out[k] = half2float(bytes[2 * k] | (bytes[2 * k + 1] << 8));
    return out;
  }

  function total(a) { var t = 0; for (var k = 0; k < a.length; k++) t += a[k]; return t; }

  function init(policy) {
    if (net) return true;
    if (!policy || !policy.w) return false;
    var d = policy.dim, h = policy.hidden, nv = policy.nvec;
    var o = total(nv), w = decode(policy.w, policy.n), p = 0;
    function take(len) { var a = w.subarray(p, p + len); p += len; return a; }
    net = {
      dim: d, hidden: h, nvec: nv,
      W0: take(h * d), b0: take(h), W1: take(h * h), b1: take(h),
      W2: take(o * h), b2: take(o),
      h1: new Float32Array(h), h2: new Float32Array(h), out: new Float32Array(o),
      obs: new Float32Array(d)
    };
    if (policy.dt) C.dt = policy.dt;
    if (policy.match_seconds) {
      C.matchSeconds = policy.match_seconds;
      C.maxSteps = Math.round(policy.match_seconds / C.dt);
    }
    if (policy.pitch) {
      C.xMax = policy.pitch.length / 2;
      C.yMax = policy.pitch.width / 2;
      C.goalHalf = policy.pitch.goal_width / 2;
    }
    return true;
  }

  function dense(W, b, x, y, nOut, nIn, tanh) {
    for (var o = 0, base = 0; o < nOut; o++, base += nIn) {
      var acc = b[o];
      for (var k = 0; k < nIn; k++) acc += W[base + k] * x[k];
      y[o] = tanh ? Math.tanh(acc) : acc;
    }
  }

  function argmaxSlice(v, from, len) {
    var best = from;
    for (var k = from + 1; k < from + len; k++) if (v[k] > v[best]) best = k;
    return best - from;
  }

  /* ---------- observations égocentriques (obs2.py, fine=True) ---------- */
  var FULL_X = 105.0, FULL_Y = 68.0, FINE = 10.0;

  function clip(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function observe(st, me, out) {
    var sign = me === 0 ? 1 : -1, opp = 1 - me;
    var hx = C.xMax, hy = C.yMax, vmax = C.maxSpeed * C.sprintMult, bmax = C.kickSpeed[1];
    var diag = Math.hypot(2 * hx, 2 * hy);
    var px = st.pos[me][0], py = st.pos[me][1];
    var rbx = st.ball[0] - px, rby = st.ball[1] - py;
    var rox = st.pos[opp][0] - px, roy = st.pos[opp][1] - py;
    var tgx = (me === 0 ? hx : -hx) - px, tgy = -py;
    var ogx = (me === 0 ? -hx : hx) - px, ogy = -py;
    var k = 0;
    out[k++] = sign * px / hx; out[k++] = sign * py / hy;
    out[k++] = sign * st.vel[me][0] / vmax; out[k++] = sign * st.vel[me][1] / vmax;
    out[k++] = sign * rbx / FULL_X; out[k++] = sign * rby / FULL_Y;
    out[k++] = Math.hypot(rbx, rby) / diag;
    out[k++] = sign * st.bvel[0] / bmax; out[k++] = sign * st.bvel[1] / bmax;
    out[k++] = sign * rox / FULL_X; out[k++] = sign * roy / FULL_Y;
    out[k++] = sign * st.vel[opp][0] / vmax; out[k++] = sign * st.vel[opp][1] / vmax;
    out[k++] = sign * tgx / FULL_X; out[k++] = sign * tgy / FULL_Y;
    out[k++] = sign * ogx / FULL_X; out[k++] = sign * ogy / FULL_Y;
    out[k++] = st.poss === me ? 1 : 0;
    out[k++] = st.poss === opp ? 1 : 0;
    out[k++] = st.poss < 0 ? 1 : 0;
    out[k++] = st.grace / C.graceSteps;
    out[k++] = (st.kickTimer > 0 && st.kicker === me) ? 1 : 0;
    out[k++] = (st.restartTimer > 0 && st.restartOwner === me) ? 1 : 0;
    out[k++] = (st.restartTimer > 0 && st.restartOwner === opp) ? 1 : 0;
    out[k++] = 1.0 - st.stepCount / C.maxSteps;
    out[k++] = clip(sign * rbx / FINE, -1, 1); out[k++] = clip(sign * rby / FINE, -1, 1);
    out[k++] = clip(sign * rox / FINE, -1, 1); out[k++] = clip(sign * roy / FINE, -1, 1);
    out[k++] = Math.hypot(st.ball[0] - st.pos[opp][0], st.ball[1] - st.pos[opp][1]) / diag;
    for (var j = 0; j < k; j++) out[j] = clip(out[j], -1.5, 1.5);
    return out;
  }

  /* action gloutonne du joueur `me`, convertie dans le repère du monde */
  function decide(st, me) {
    observe(st, me, net.obs);
    dense(net.W0, net.b0, net.obs, net.h1, net.hidden, net.dim, true);
    dense(net.W1, net.b1, net.h1, net.h2, net.hidden, net.hidden, true);
    dense(net.W2, net.b2, net.h2, net.out, net.out.length, net.hidden, false);
    var nv = net.nvec, a = [], off = 0;
    for (var t = 0; t < nv.length; t++) { a.push(argmaxSlice(net.out, off, nv[t])); off += nv[t]; }
    if (me === 1) {                                   // le joueur 2 voit le terrain à l'envers
      if (a[0] < N_MOVE) a[0] = (a[0] + N_MOVE / 2) % N_MOVE;
      a[3] = (a[3] + N_KICK / 2) % N_KICK;
    }
    return a;
  }

  /* ---------- départ (match.py : reset) ---------- */
  function newState(rand) {
    var m = C.margin, lo = [-C.xMax + m, -C.yMax + m], hi = [C.xMax - m, C.yMax - m];
    function spot() { return [lo[0] + rand() * (hi[0] - lo[0]), lo[1] + rand() * (hi[1] - lo[1])]; }
    var p0 = spot(), p1 = spot(), minSep = 2.2 * C.radius, tries = 0;
    while (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < minSep && tries++ < 100) p1 = spot();
    var st = {
      pos: [p0, p1], vel: [[0, 0], [0, 0]], ball: [0, 0], bvel: [0, 0],
      poss: -1, lastTouch: -1, kicker: -1, kickTimer: 0, grace: 0,
      restartTimer: 0, restartOwner: -1, stepCount: 0, outcome: PLAYING, spawn: 0
    };
    var u = rand(), mode = u < C.spawnMix[0] ? 0 : (u < C.spawnMix[0] + C.spawnMix[1] ? 1 : 2);
    st.spawn = mode;
    if (mode === 0) {
      st.ball = [lo[0] + rand() * (hi[0] - lo[0]), lo[1] + rand() * (hi[1] - lo[1])];
    } else if (mode === 1) {
      var c = C.centreHalf;
      st.ball = [-c + rand() * 2 * c, -c + rand() * 2 * c];
    } else {
      var owner = rand() < 0.5 ? 0 : 1;
      st.ball = [st.pos[owner][0], st.pos[owner][1]];
      st.poss = owner; st.lastTouch = owner; st.grace = C.graceSteps;
    }
    return st;
  }

  /* ---------- un pas de temps (match.py : VecMatch.step) ---------- */
  function collide(st) {
    var minD = 2 * C.radius;
    for (var it = 0; it < C.collIters; it++) {
      var dx = st.pos[1][0] - st.pos[0][0], dy = st.pos[1][1] - st.pos[0][1];
      var d = Math.hypot(dx, dy);
      if (!(d < minD)) return;
      if (d < 1e-9) { dx = minD; dy = 0; d = minD; }
      var nx = dx / d, ny = dy / d, push = 0.5 * (minD - d);
      st.pos[0][0] -= push * nx; st.pos[0][1] -= push * ny;
      st.pos[1][0] += push * nx; st.pos[1][1] += push * ny;
      var vn = (st.vel[1][0] - st.vel[0][0]) * nx + (st.vel[1][1] - st.vel[0][1]) * ny;
      if (vn < 0) {
        st.vel[0][0] += 0.5 * vn * nx; st.vel[0][1] += 0.5 * vn * ny;
        st.vel[1][0] -= 0.5 * vn * nx; st.vel[1][1] -= 0.5 * vn * ny;
      }
    }
  }

  /* franchissement de ligne entre deux positions du ballon : but, sortie, point de sortie */
  function boundary(b0, b1) {
    var dx = b1[0] - b0[0], dy = b1[1] - b0[1], INF = Infinity;
    var ts = [dx > 0 ? (C.xMax - b0[0]) / dx : INF, dx < 0 ? (-C.xMax - b0[0]) / dx : INF,
              dy > 0 ? (C.yMax - b0[1]) / dy : INF, dy < 0 ? (-C.yMax - b0[1]) / dy : INF];
    var k, tmin = INF, first = 0;
    for (k = 0; k < 4; k++) {
      if (!(ts[k] >= 0 && ts[k] <= 1)) ts[k] = INF;
      if (ts[k] < tmin) { tmin = ts[k]; first = k; }
    }
    var outside = b1[0] >= C.xMax || b1[0] <= -C.xMax || b1[1] >= C.yMax || b1[1] <= -C.yMax;
    if (!isFinite(tmin) && !outside) return null;
    var pt;
    if (isFinite(tmin)) {
      pt = [b0[0] + tmin * dx, b0[1] + tmin * dy];
    } else {                                    // ballon déjà dehors : on prend sa position
      pt = [b1[0], b1[1]];
      first = b1[0] >= C.xMax ? 0 : (b1[0] <= -C.xMax ? 1 : 2);
    }
    var mouth = Math.abs(pt[1]) <= C.goalHalf;
    return { goal1: first === 0 && mouth, goal2: first === 1 && mouth, pt: pt };
  }

  function step(st, aw, u) {
    st.kickTimer = Math.max(st.kickTimer - 1, 0);
    st.grace = Math.max(st.grace - 1, 0);
    st.restartTimer = Math.max(st.restartTimer - 1, 0);
    if (st.restartTimer === 0) st.restartOwner = -1;

    var i;
    for (i = 0; i < 2; i++) {
      var mv = aw[i][0], moving = mv < N_MOVE;
      var dirx = moving ? DIRS_MOVE[mv][0] : 0, diry = moving ? DIRS_MOVE[mv][1] : 0;
      var mult = st.poss === i ? C.carrierMult : 1.0;
      var want = C.maxSpeed * (aw[i][1] === 1 ? C.sprintMult : 1.0) * mult;
      var dvx = dirx * want - st.vel[i][0], dvy = diry * want - st.vel[i][1];
      var dvn = Math.hypot(dvx, dvy), k1 = Math.min(1.0, C.accel * C.dt / Math.max(dvn, 1e-9));
      var vx = st.vel[i][0] + dvx * k1, vy = st.vel[i][1] + dvy * k1;
      var cap = C.maxSpeed * C.sprintMult * mult, spd = Math.hypot(vx, vy);
      var k2 = Math.min(1.0, cap / Math.max(spd, 1e-9));
      st.vel[i][0] = vx * k2; st.vel[i][1] = vy * k2;
      st.pos[i][0] += st.vel[i][0] * C.dt; st.pos[i][1] += st.vel[i][1] * C.dt;
    }
    collide(st);
    for (i = 0; i < 2; i++) {
      st.pos[i][0] = clip(st.pos[i][0], -C.xMax, C.xMax);
      st.pos[i][1] = clip(st.pos[i][1], -C.yMax, C.yMax);
    }

    var before = [st.ball[0], st.ball[1]];
    var has = st.poss >= 0, p = Math.max(st.poss, 0), opp = 1 - p;
    var tackled = false;
    if (has && st.grace === 0 && u < C.tackleP) {
      var dOpp = Math.hypot(st.pos[opp][0] - st.pos[p][0], st.pos[opp][1] - st.pos[p][1]);
      if (dOpp <= C.tackleR) {
        tackled = true;
        st.poss = opp; st.grace = C.graceSteps; st.lastTouch = opp;
        st.ball = [st.pos[opp][0], st.pos[opp][1]]; st.bvel = [0, 0];
      }
    }
    var pa = aw[p], kicked = false;
    if (has && !tackled && (pa[2] === 1 || pa[2] === 2)) {
      kicked = true;
      var kd = DIRS_KICK[pa[3]];
      var kspd = (pa[2] === 1 ? C.kickSpeed : C.passSpeed)[pa[4]];
      st.bvel = [kd[0] * kspd, kd[1] * kspd];
      st.ball = [st.pos[p][0] + kd[0] * C.dribble, st.pos[p][1] + kd[1] * C.dribble];
      st.kicker = p; st.kickTimer = C.kickCool; st.poss = -1; st.lastTouch = p;
    } else if (has && !tackled) {                         // conduite de balle
      var v = st.vel[p], vn = Math.hypot(v[0], v[1]);
      var hdx = vn > 1e-6 ? v[0] / vn : 0, hdy = vn > 1e-6 ? v[1] / vn : 0;
      st.ball = [st.pos[p][0] + hdx * C.dribble, st.pos[p][1] + hdy * C.dribble];
      st.bvel = [v[0], v[1]];
    }

    if (!has || kicked) {                                  // ballon libre
      st.ball[0] += st.bvel[0] * C.dt; st.ball[1] += st.bvel[1] * C.dt;
      st.bvel[0] *= C.damping; st.bvel[1] *= C.damping;
      var slow = Math.hypot(st.bvel[0], st.bvel[1]) <= C.controlSpeed;
      var best = -1, bestD = Infinity;
      for (i = 0; i < 2; i++) {
        var d = Math.hypot(st.pos[i][0] - st.ball[0], st.pos[i][1] - st.ball[1]);
        if (!slow || d > C.possR) continue;
        if (st.kickTimer > 0 && st.kicker === i) continue;
        if (st.restartTimer > 0 && st.restartOwner >= 0 && i !== st.restartOwner) continue;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        st.poss = best; st.grace = C.graceSteps; st.bvel = [0, 0]; st.lastTouch = best;
        st.restartTimer = 0; st.restartOwner = -1;
      }
    }

    var bd = boundary(before, st.ball);
    if (bd) {
      if (bd.goal1) st.outcome = GOAL_P1;
      else if (bd.goal2) st.outcome = GOAL_P2;
      else {                                               // remise en jeu pour l'adversaire
        st.ball[0] = clip(bd.pt[0], -C.xMax + C.inset, C.xMax - C.inset);
        st.ball[1] = clip(bd.pt[1], -C.yMax + C.inset, C.yMax - C.inset);
        st.bvel = [0, 0]; st.poss = -1; st.kickTimer = 0;
        st.restartOwner = st.lastTouch >= 0 ? 1 - st.lastTouch : -1;
        st.restartTimer = st.lastTouch >= 0 ? C.restartSteps : 0;
      }
    }
    st.stepCount += 1;
    if (st.outcome === PLAYING && st.stepCount >= C.maxSteps) st.outcome = DRAW;
    return st.outcome;
  }

  function frame(st) {
    return [st.pos[0][0], st.pos[0][1], st.pos[1][0], st.pos[1][1],
            st.ball[0], st.ball[1], st.poss];
  }

  /* ---------- un match, joué un pas à la fois ---------- */
  function Match(rand) {
    this.rand = rand || Math.random;
    this.state = newState(this.rand);
    this.frames = [frame(this.state)];
    this.outcome = null;
    this.spawn = this.state.spawn;
  }

  Match.prototype.advance = function (nSteps) {
    for (var k = 0; k < nSteps && this.outcome === null; k++) {
      var st = this.state;
      var aw = [decide(st, 0), decide(st, 1)];
      var o = step(st, aw, this.rand());
      this.frames.push(frame(st));
      if (o !== PLAYING) this.outcome = OUTCOMES[o];
    }
    return this.outcome;
  };

  Match.prototype.duration = function () { return (this.frames.length - 1) * C.dt; };

  return {
    init: init,
    ready: function () { return !!net; },
    config: C,
    match: function (rand) { return new Match(rand); },
    _internals: { newState: newState, step: step, decide: decide, observe: observe, frame: frame }
  };
});
