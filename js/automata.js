/* Finite automata: constructions, conversions and checks.
   FA shape: {n, start, finals:Set<int>, trans:[{from, sym, to}], labels:[string]}
   sym === DT.EPS means a λ-transition. */
(function (DT) {
  'use strict';
  const EPS = DT.EPS;
  const R = DT.regex.R;

  const sortNum = (s) => [...s].sort((a, b) => a - b);
  const keyOf = (s) => sortNum(s).join(',');
  const range = (n) => [...Array(n).keys()];

  function letterName(i) {
    let s = ''; i++;
    while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
    return s;
  }

  function alphabetOf(fa) {
    return [...new Set(fa.trans.map((t) => t.sym).filter((s) => s !== EPS))].sort();
  }
  function delta(fa) {
    const d = range(fa.n).map(() => new Map());
    for (const t of fa.trans) {
      if (!d[t.from].has(t.sym)) d[t.from].set(t.sym, new Set());
      d[t.from].get(t.sym).add(t.to);
    }
    return d;
  }
  function closure(d, set) {
    const res = new Set(set), st = [...set];
    while (st.length) {
      const u = st.pop(), e = d[u].get(EPS);
      if (e) for (const v of e) if (!res.has(v)) { res.add(v); st.push(v); }
    }
    return res;
  }
  function move(d, set, a) {
    const r = new Set();
    for (const u of set) { const e = d[u].get(a); if (e) for (const v of e) r.add(v); }
    return r;
  }
  function hasEps(fa) { return fa.trans.some((t) => t.sym === EPS); }
  function isDFA(fa) {
    if (hasEps(fa)) return false;
    const seen = new Set();
    for (const t of fa.trans) { const k = t.from + '|' + t.sym; if (seen.has(k)) return false; seen.add(k); }
    return true;
  }
  function isComplete(fa, A) {
    const seen = new Set(fa.trans.map((t) => t.from + '|' + t.sym));
    return range(fa.n).every((q) => A.every((a) => seen.has(q + '|' + a)));
  }
  function setStr(labels, arr) { return arr.length ? '{' + arr.map((i) => labels[i]).join(',') + '}' : '∅'; }
  function clone(fa) {
    return { n: fa.n, start: fa.start, finals: new Set(fa.finals), trans: fa.trans.map((t) => ({ ...t })), labels: [...fa.labels] };
  }

  // RE → λ-NFA (Thompson)
  function thompson(ast) {
    let n = 0;
    const T = [], parts = [];
    const add = (f, s, t) => T.push({ from: f, sym: s, to: t });
    function b(e) {
      let s, f;
      if (e.t === 'sym' || e.t === 'eps') { s = n++; f = n++; add(s, e.t === 'sym' ? e.v : EPS, f); }
      else if (e.t === 'empty') { s = n++; f = n++; }
      else if (e.t === 'cat') { const A = b(e.a), B = b(e.b); add(A.f, EPS, B.s); s = A.s; f = B.f; }
      else if (e.t === 'or') {
        s = n++; const A = b(e.a), B = b(e.b); f = n++;
        add(s, EPS, A.s); add(s, EPS, B.s); add(A.f, EPS, f); add(B.f, EPS, f);
      } else {
        s = n++; const A = b(e.a); f = n++;
        add(s, EPS, A.s); add(A.f, EPS, A.s); add(A.f, EPS, f); add(s, EPS, f);
      }
      parts.push({ re: DT.regex.astStr(e), kind: e.t, s, f });
      return { s, f };
    }
    const r = b(ast);
    const adj = range(n).map(() => []);
    T.forEach((t) => adj[t.from].push(t.to));
    const map = new Array(n).fill(-1);
    let k = 0; const q = [r.s]; map[r.s] = k++;
    while (q.length) { const u = q.shift(); for (const v of adj[u]) if (map[v] < 0) { map[v] = k++; q.push(v); } }
    for (let i = 0; i < n; i++) if (map[i] < 0) map[i] = k++;
    return {
      fa: { n, start: 0, finals: new Set([map[r.f]]), trans: T.map((t) => ({ from: map[t.from], sym: t.sym, to: map[t.to] })), labels: range(n).map((i) => 'q' + i) },
      parts: parts.map((p) => ({ ...p, s: map[p.s], f: map[p.f] }))
    };
  }

  // λ-NFA → NFA (λ-closure method)
  function removeEps(fa) {
    const d = delta(fa), A = alphabetOf(fa);
    const cl = range(fa.n).map((q) => closure(d, [q]));
    const nd = [], finals = new Set(), rows = [];
    for (let q = 0; q < fa.n; q++) {
      const row = { q, closure: sortNum(cl[q]), next: {}, final: false };
      nd[q] = {};
      for (const a of A) { const m = closure(d, move(d, cl[q], a)); nd[q][a] = m; row.next[a] = sortNum(m); }
      if ([...cl[q]].some((x) => fa.finals.has(x))) { finals.add(q); row.final = true; }
      rows.push(row);
    }
    const reach = new Set([fa.start]), st = [fa.start];
    while (st.length) { const u = st.pop(); for (const a of A) for (const v of nd[u][a]) if (!reach.has(v)) { reach.add(v); st.push(v); } }
    rows.forEach((r) => (r.reachable = reach.has(r.q)));
    const keep = sortNum(reach), idx = new Map(keep.map((q, i) => [q, i]));
    const trans = [];
    for (const q of keep) for (const a of A) for (const v of sortNum(nd[q][a])) trans.push({ from: idx.get(q), sym: a, to: idx.get(v) });
    return {
      fa: { n: keep.length, start: idx.get(fa.start), finals: new Set(keep.filter((q) => finals.has(q)).map((q) => idx.get(q))), trans, labels: keep.map((q) => fa.labels[q]) },
      rows, alphabet: A, removed: fa.n - keep.length
    };
  }

  // NFA / λ-NFA → DFA (subset construction)
  function subset(fa, alphabet) {
    const d = delta(fa), A = alphabet || alphabetOf(fa);
    const sets = [], keys = new Map(), trans = [];
    const get = (S) => { const k = keyOf(S); if (!keys.has(k)) { keys.set(k, sets.length); sets.push(S); } return keys.get(k); };
    get(closure(d, [fa.start]));
    for (let i = 0; i < sets.length; i++) for (const a of A) trans.push({ from: i, sym: a, to: get(closure(d, move(d, sets[i], a))) });
    let c = 0;
    const labels = sets.map((S) => (S.size === 0 ? '∅' : letterName(c++)));
    const finals = new Set();
    sets.forEach((S, i) => { if ([...S].some((x) => fa.finals.has(x))) finals.add(i); });
    return { fa: { n: sets.length, start: 0, finals, trans, labels }, sets: sets.map(sortNum), alphabet: A, srcLabels: fa.labels };
  }

  function trimUnreachable(fa) {
    const d = delta(fa), reach = new Set([fa.start]), st = [fa.start];
    while (st.length) { const u = st.pop(); for (const [, vs] of d[u]) for (const v of vs) if (!reach.has(v)) { reach.add(v); st.push(v); } }
    const keep = sortNum(reach), idx = new Map(keep.map((q, i) => [q, i]));
    return {
      fa: { n: keep.length, start: idx.get(fa.start), finals: new Set(keep.filter((q) => fa.finals.has(q)).map((q) => idx.get(q))), trans: fa.trans.filter((t) => reach.has(t.from) && reach.has(t.to)).map((t) => ({ ...t, from: idx.get(t.from), to: idx.get(t.to) })), labels: keep.map((q) => fa.labels[q]) },
      removed: range(fa.n).filter((q) => !reach.has(q)).map((q) => fa.labels[q])
    };
  }

  function complete(fa, A) {
    if (isComplete(fa, A)) return { fa, added: null };
    const g = clone(fa);
    let name = '∅';
    if (g.labels.includes(name)) { name = 'T'; let k = 1; while (g.labels.includes(name)) name = 'T' + k++; }
    const t = g.n++; g.labels.push(name);
    const seen = new Set(g.trans.map((x) => x.from + '|' + x.sym));
    for (let q = 0; q < g.n; q++) for (const a of A) if (!seen.has(q + '|' + a)) g.trans.push({ from: q, sym: a, to: t });
    return { fa: g, added: name };
  }

  /* States that can never reach a final state (trap/dead). Start state is never hidden. */
  function deadStates(fa) {
    const rev = range(fa.n).map(() => []);
    fa.trans.forEach((t) => rev[t.to].push(t.from));
    const live = new Set(fa.finals), st = [...fa.finals];
    while (st.length) { const u = st.pop(); for (const v of rev[u]) if (!live.has(v)) { live.add(v); st.push(v); } }
    return new Set(range(fa.n).filter((q) => !live.has(q) && q !== fa.start));
  }

  // DFA minimization (Linz "mark" + "reduce", and π-partition)
  function minimize(input) {
    const notes = [];
    let fa = input, A = alphabetOf(input);
    let viaSubset = null;
    if (!isDFA(fa)) {
      viaSubset = subset(fa, A);
      fa = viaSubset.fa;
      notes.push('Input is not a DFA, so it was converted with subset construction first.');
    }
    const tr = trimUnreachable(fa);
    if (tr.removed.length) notes.push(`Removed inaccessible state(s): ${tr.removed.join(', ')}.`);
    fa = tr.fa;
    const cm = complete(fa, A);
    if (cm.added) notes.push(`DFA was incomplete, so trap state ${cm.added} was added.`);
    fa = cm.fa;
    const n = fa.n, F = fa.finals, L = fa.labels;
    const nx = range(n).map(() => ({}));
    fa.trans.forEach((t) => (nx[t.from][t.sym] = t.to));

    // mark procedure (table filling)
    const mark = range(n).map(() => new Array(n).fill(null));
    const pk = (p, q) => (p > q ? [p, q] : [q, p]);
    const marked = (p, q) => { const [i, j] = pk(p, q); return mark[i][j]; };
    const passes = [];
    const p0 = [];
    for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) if (F.has(i) !== F.has(j)) { mark[i][j] = { pass: 0 }; p0.push({ i, j }); }
    passes.push(p0);
    for (let pass = 1; ; pass++) {
      const now = [];
      for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) {
        if (mark[i][j]) continue;
        for (const a of A) {
          const m = marked(nx[i][a], nx[j][a]);
          if (nx[i][a] !== nx[j][a] && m && m.pass < pass) { now.push({ i, j, a, to: pk(nx[i][a], nx[j][a]) }); break; }
        }
      }
      if (!now.length) break;
      now.forEach((x) => (mark[x.i][x.j] = { pass, a: x.a, to: x.to }));
      passes.push(now);
    }

    // π-partition (equivalence method)
    let part = range(n).map((q) => (F.has(q) ? 1 : 0));
    const norm = (arr) => { const m = new Map(); return arr.map((x) => { if (!m.has(x)) m.set(x, m.size); return m.get(x); }); };
    part = norm(part);
    const groupsOf = (pt) => { const g = []; pt.forEach((c, q) => { (g[c] = g[c] || []).push(q); }); return g; };
    const partitions = [groupsOf(part)];
    for (;;) {
      const sig = range(n).map((q) => part[q] + '|' + A.map((a) => part[nx[q][a]]).join(','));
      const np = norm(sig);
      const cnt = new Set(np).size, old = new Set(part).size;
      part = np;
      if (cnt === old) break;
      partitions.push(groupsOf(part));
    }

    // classes from mark table (should match the final partition)
    const cls = range(n).map((q) => q);
    const find = (x) => (cls[x] === x ? x : (cls[x] = find(cls[x])));
    for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) if (!mark[i][j]) cls[find(i)] = find(j);
    const groupMap = new Map();
    range(n).forEach((q) => { const r = find(q); if (!groupMap.has(r)) groupMap.set(r, []); groupMap.get(r).push(q); });
    let groups = [...groupMap.values()].sort((a, b) => a[0] - b[0]);
    // order with the start group first, rest in BFS order
    const gid = new Map(); groups.forEach((g, i) => g.forEach((q) => gid.set(q, i)));
    const order = [], seen = new Set([gid.get(fa.start)]), queue = [gid.get(fa.start)];
    while (queue.length) { const g = queue.shift(); order.push(g); for (const a of A) { const h = gid.get(nx[groups[g][0]][a]); if (!seen.has(h)) { seen.add(h); queue.push(h); } } }
    groups.forEach((_, i) => { if (!seen.has(i)) order.push(i); });
    groups = order.map((i) => groups[i]);
    const gi = new Map(); groups.forEach((g, i) => g.forEach((q) => gi.set(q, i)));
    const labels = groups.map((g) => (g.length === 1 ? L[g[0]] : '{' + g.map((q) => L[q]).join(',') + '}'));
    const trans = [];
    groups.forEach((g, i) => A.forEach((a) => trans.push({ from: i, sym: a, to: gi.get(nx[g[0]][a]) })));
    const min = { n: groups.length, start: gi.get(fa.start), finals: new Set(groups.map((g, i) => (F.has(g[0]) ? i : -1)).filter((i) => i >= 0)), trans, labels };
    return { notes, viaSubset, dfa: fa, alphabet: A, mark, passes, partitions, groups, min, labels: L };
  }

  // FA → RE (generalized transition graph / state elimination)
  // Without a given order, try many elimination orders and keep the shortest expression.
  function toRegex(fa, orderLabels) {
    if (orderLabels && orderLabels.length) return eliminate(fa, orderLabels);
    const tr = trimUseless(fa);
    const base = tr.fa;
    let best = eliminate(base, null);
    const n = base.n;
    const tryOrder = (ord) => { const r = eliminate(base, ord.map((i) => base.labels[i])); if (r.regex.length < best.regex.length) best = r; };
    if (n <= 7) {
      const perm = (arr, k) => {
        if (k === arr.length) { tryOrder(arr); return; }
        for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; perm(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
      };
      perm(range(n), 0);
    } else {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < 400; t++) { const a = range(n); for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } tryOrder(a); }
    }
    best.removed = tr.removed;
    best.fa = base;
    return best;
  }
  // drop states that are unreachable or cannot reach a final state (they add nothing to the RE)
  function trimUseless(fa) {
    const t = trimUnreachable(fa);
    const dead = deadStates(t.fa);
    if (!dead.size) return { fa: t.fa, removed: t.removed };
    const keep = range(t.fa.n).filter((q) => !dead.has(q)), idx = new Map(keep.map((q, i) => [q, i]));
    const g = t.fa;
    return {
      fa: { n: keep.length, start: idx.get(g.start), finals: new Set([...g.finals].filter((q) => idx.has(q)).map((q) => idx.get(q))), trans: g.trans.filter((x) => idx.has(x.from) && idx.has(x.to)).map((x) => ({ ...x, from: idx.get(x.from), to: idx.get(x.to) })), labels: keep.map((q) => g.labels[q]) },
      removed: [...t.removed, ...[...dead].map((q) => g.labels[q])]
    };
  }
  function eliminate(fa, orderLabels) {
    const N = fa.n;
    const pick = (base) => { let s = base, k = 1; while (fa.labels.includes(s)) s = base + k++; return s; };
    const names = [...fa.labels, pick('S'), pick('F')];
    const S = N, F = N + 1;
    const E = new Map();
    const k = (i, j) => i + ',' + j;
    const getE = (i, j) => E.get(k(i, j)) || null;
    const setE = (i, j, r) => { if (r) E.set(k(i, j), r); else E.delete(k(i, j)); };
    for (const t of fa.trans) setE(t.from, t.to, R.or(getE(t.from, t.to), t.sym === EPS ? R.eps : R.sym(t.sym)));
    setE(S, fa.start, R.or(getE(S, fa.start), R.eps));
    for (const f of fa.finals) setE(f, F, R.or(getE(f, F), R.eps));
    const alive = new Set([...range(N), S, F]);
    const snap = () => ({ nodes: [...alive], edges: [...E.entries()].map(([kk, r]) => { const [i, j] = kk.split(',').map(Number); return { from: i, to: j, label: R.str(r) }; }) });
    const steps = [{ q: null, lines: [], snap: snap() }];
    const remaining = range(N);
    let order = [];
    if (orderLabels && orderLabels.length) {
      for (const lb of orderLabels) {
        const i = fa.labels.indexOf(lb);
        if (i < 0) throw new Error(`No state named "${lb}" in the elimination order.`);
        if (!order.includes(i)) order.push(i);
      }
    }
    const ins = (q) => [...alive].filter((p) => p !== q && getE(p, q));
    const outs = (q) => [...alive].filter((r) => r !== q && getE(q, r));
    const done = new Set();
    const next = () => {
      while (order.length) { const q = order.shift(); if (!done.has(q)) return q; }
      let best = -1, bc = Infinity;
      for (const q of remaining) if (!done.has(q)) { const c = ins(q).length * outs(q).length; if (c < bc) { bc = c; best = q; } }
      return best;
    };
    for (let step = 0; step < N; step++) {
      const q = next();
      if (q < 0) break;
      done.add(q);
      const loop = getE(q, q), lines = [];
      const I = ins(q), O = outs(q);
      for (const p of I) for (const r of O) {
        const old = getE(p, r);
        const add = R.cat(R.cat(getE(p, q), R.star(loop)), getE(q, r));
        const nw = R.or(old, add);
        lines.push({ p, r, old: old ? R.str(old) : null, pq: R.str(getE(p, q)), qq: loop ? R.str(loop) : null, qr: R.str(getE(q, r)), add: R.str(add), res: R.str(nw) });
        setE(p, r, nw);
      }
      for (const kk of [...E.keys()]) { const [i, j] = kk.split(',').map(Number); if (i === q || j === q) E.delete(kk); }
      alive.delete(q);
      steps.push({ q, loop: loop ? R.str(loop) : null, lines, snap: snap() });
    }
    const res = getE(S, F);
    return { names, S, F, steps, regex: res ? R.str(res) : '∅', empty: !res };
  }

  // FA ↔ regular grammars
  function varNames(fa, startVar = 'S') {
    const pool = 'ABCDEFGHIJKLMNOPQRTUVWXYZ'.split('').filter((c) => c !== startVar);
    const names = new Array(fa.n);
    names[fa.start] = startVar;
    let k = 0;
    for (let q = 0; q < fa.n; q++) if (q !== fa.start) names[q] = k < pool.length ? pool[k++] : 'X' + (k++ - pool.length + 1);
    return names;
  }
  function groupProds(list) {
    const m = new Map();
    for (const p of list) { if (!m.has(p.lhs)) m.set(p.lhs, []); if (!m.get(p.lhs).includes(p.rhs)) m.get(p.lhs).push(p.rhs); }
    return [...m.entries()].map(([lhs, rhs]) => ({ lhs, rhs }));
  }
  function toRightLinear(fa) {
    const tr = trimUnreachable(fa).fa;
    const V = varNames(tr);
    const list = [];
    const qs = [tr.start, ...range(tr.n).filter((q) => q !== tr.start)];
    for (const q of qs) {
      for (const t of tr.trans.filter((x) => x.from === q)) list.push({ lhs: V[q], rhs: (t.sym === EPS ? '' : t.sym) + V[t.to] });
      if (tr.finals.has(q)) list.push({ lhs: V[q], rhs: EPS });
    }
    return { fa: tr, vars: V, prods: groupProds(list), start: 'S' };
  }
  function reverse(fa) {
    // Linz: finals become start (via a new start with λ-moves if several), start becomes the only final.
    const g = { n: fa.n, start: 0, finals: new Set([fa.start]), trans: fa.trans.map((t) => ({ from: t.to, sym: t.sym, to: t.from })), labels: [...fa.labels] };
    const F = [...fa.finals];
    let note = '';
    if (F.length === 1) g.start = F[0];
    else {
      let nm = 'q_s', k = 1; while (g.labels.includes(nm)) nm = 'q_s' + k++;
      g.start = g.n++; g.labels.push(nm);
      F.forEach((f) => g.trans.push({ from: g.start, sym: EPS, to: f }));
      note = F.length ? `Several final states, so new start ${nm} with λ-moves to each of them.` : 'No final state: language is empty.';
    }
    return { fa: g, note };
  }
  function toLeftLinear(fa) {
    const tr = trimUnreachable(fa).fa;
    const rv = reverse(tr);
    const rl = toRightLinear(rv.fa);
    const revStr = (s) => (s === EPS ? EPS : DT.grammar.tokenize(s).reverse().join(''));
    const prods = rl.prods.map((p) => ({ lhs: p.lhs, rhs: p.rhs.map(revStr) }));
    return { reversed: rv, right: rl, prods };
  }

  // Simulation, equivalence, products
  function accepts(fa, w) {
    const d = delta(fa);
    let cur = closure(d, [fa.start]);
    const trace = [sortNum(cur)];
    for (const ch of w) { cur = closure(d, move(d, cur, ch)); trace.push(sortNum(cur)); }
    return { ok: [...cur].some((q) => fa.finals.has(q)), trace };
  }
  function equivalent(A, B) {
    const alpha = [...new Set([...alphabetOf(A), ...alphabetOf(B)])].sort();
    const dA = delta(A), dB = delta(B);
    const acc = (fa, s) => [...s].some((q) => fa.finals.has(q));
    const s0 = [closure(dA, [A.start]), closure(dB, [B.start])];
    const seen = new Set([keyOf(s0[0]) + '#' + keyOf(s0[1])]);
    const q = [[s0[0], s0[1], '']];
    let guard = 0;
    while (q.length && guard++ < 200000) {
      const [x, y, w] = q.shift();
      if (acc(A, x) !== acc(B, y)) return { eq: false, witness: w, inA: acc(A, x) };
      for (const a of alpha) {
        const nx = closure(dA, move(dA, x, a)), ny = closure(dB, move(dB, y, a));
        const kk = keyOf(nx) + '#' + keyOf(ny);
        if (!seen.has(kk)) { seen.add(kk); q.push([nx, ny, w + a]); }
      }
    }
    return { eq: true };
  }
  function complementDFA(fa, A) {
    const c = complete(trimUnreachable(isDFA(fa) ? fa : subset(fa, A).fa).fa, A).fa;
    return { ...c, finals: new Set(range(c.n).filter((q) => !c.finals.has(q))) };
  }
  function product(A, B, op, alpha) {
    const a = complete(isDFA(A) ? A : subset(A, alpha).fa, alpha).fa;
    const b = complete(isDFA(B) ? B : subset(B, alpha).fa, alpha).fa;
    const na = range(a.n).map(() => ({})), nb = range(b.n).map(() => ({}));
    a.trans.forEach((t) => (na[t.from][t.sym] = t.to));
    b.trans.forEach((t) => (nb[t.from][t.sym] = t.to));
    const ids = new Map(), pairs = [], trans = [];
    const get = (x, y) => { const k = x + ',' + y; if (!ids.has(k)) { ids.set(k, pairs.length); pairs.push([x, y]); } return ids.get(k); };
    get(a.start, b.start);
    for (let i = 0; i < pairs.length; i++) for (const s of alpha) trans.push({ from: i, sym: s, to: get(na[pairs[i][0]][s], nb[pairs[i][1]][s]) });
    const finals = new Set(pairs.map(([x, y], i) => { const fx = a.finals.has(x), fy = b.finals.has(y); return (op === 'and' ? fx && fy : fx || fy) ? i : -1; }).filter((i) => i >= 0));
    return { n: pairs.length, start: 0, finals, trans, labels: pairs.map(([x, y]) => '(' + a.labels[x] + ',' + b.labels[y] + ')') };
  }

  // Language description → DFA
  function kmpDFA(w, A, mode) {
    // states 0..m = length of longest prefix of w that is a suffix of input read so far
    const m = w.length, trans = [];
    const delta1 = (k, c) => { let s = w.slice(0, k) + c; while (s.length && !w.startsWith(s)) s = s.slice(1); return s.length; };
    for (let k = 0; k <= m; k++) for (const c of A) {
      let to;
      if (mode === 'contains' && k === m) to = m;
      else to = k === m ? delta1(m, c) : delta1(k, c);
      trans.push({ from: k, sym: c, to });
    }
    return { n: m + 1, start: 0, finals: new Set([m]), trans, labels: range(m + 1).map((i) => 'q' + i) };
  }
  function buildCondition(c, A) {
    const w = c.w || '';
    if ((c.type === 'starts' || c.type === 'ends' || c.type === 'contains') && [...w].some((ch) => !A.includes(ch))) throw new Error(`"${w}" uses a symbol that is not in Σ.`);
    if (c.type === 'starts') {
      const m = w.length, trans = [];
      for (let k = 0; k < m; k++) for (const s of A) trans.push({ from: k, sym: s, to: s === w[k] ? k + 1 : m + 1 });
      for (const s of A) { trans.push({ from: m, sym: s, to: m }); trans.push({ from: m + 1, sym: s, to: m + 1 }); }
      return { n: m + 2, start: 0, finals: new Set([m]), trans, labels: [...range(m + 1).map((i) => 'q' + i), 'trap'] };
    }
    if (c.type === 'ends') return kmpDFA(w, A, 'ends');
    if (c.type === 'contains') return kmpDFA(w, A, 'contains');
    if (c.type === 'lenmod' || c.type === 'countmod') {
      const m = Math.max(1, c.m | 0), r = ((c.r | 0) % m + m) % m, trans = [];
      if (c.type === 'countmod' && !A.includes(c.x)) throw new Error(`Symbol "${c.x}" is not in Σ.`);
      for (let k = 0; k < m; k++) for (const s of A) trans.push({ from: k, sym: s, to: c.type === 'lenmod' || s === c.x ? (k + 1) % m : k });
      return { n: m, start: 0, finals: new Set([r]), trans, labels: range(m).map((i) => 'q' + i) };
    }
    if (c.type === 'nthright') {
      const k = Math.max(1, c.m | 0);
      if (!A.includes(c.x)) throw new Error(`Symbol "${c.x}" is not in Σ.`);
      const trans = A.map((s) => ({ from: 0, sym: s, to: 0 }));
      trans.push({ from: 0, sym: c.x, to: 1 });
      for (let i = 1; i < k; i++) for (const s of A) trans.push({ from: i, sym: s, to: i + 1 });
      const nfa = { n: k + 1, start: 0, finals: new Set([k]), trans, labels: range(k + 1).map((i) => 'q' + i) };
      return subset(nfa, A).fa;
    }
    if (c.type === 'lencmp' || c.type === 'countcmp') {
      // exactly / at least / at most k (of symbol x, or of length)
      const k = Math.max(0, c.m | 0), trans = [];
      if (c.type === 'countcmp' && !A.includes(c.x)) throw new Error(`Symbol "${c.x}" is not in Σ.`);
      for (let i = 0; i <= k + 1; i++) for (const s of A) {
        const inc = c.type === 'lencmp' || s === c.x;
        trans.push({ from: i, sym: s, to: inc ? Math.min(i + 1, k + 1) : i });
      }
      const finals = new Set(range(k + 2).filter((i) => (c.cmp === 'eq' ? i === k : c.cmp === 'ge' ? i >= k : i <= k)));
      return { n: k + 2, start: 0, finals, trans, labels: [...range(k + 1).map((i) => 'q' + i), 'q' + (k + 1) + '+'] };
    }
    throw new Error('Unknown condition.');
  }

  DT.fa = {
    letterName, alphabetOf, delta, closure, move, hasEps, isDFA, isComplete, setStr, clone, sortNum,
    thompson, removeEps, subset, trimUnreachable, complete, deadStates, minimize, toRegex,
    varNames, toRightLinear, toLeftLinear, reverse, accepts, equivalent, complementDFA, product, buildCondition
  };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
