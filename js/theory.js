// Pumping lemma (Linz 4.3), NPDA → CFG (Linz 7.2), grammar simplification and Chomsky normal form (Linz 6.1–6.2).
(function (DT) {
  'use strict';
  const EPS = DT.EPS;

  // ---------- pumping lemma ----------
  const count = (s, c) => [...s].filter((x) => x === c).length;
  const isPrime = (n) => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
  const rev = (s) => [...s].reverse().join('');
  const LANGUAGES = {
    anbn: { why: 'Because |xy| ≤ p, y holds only a\'s. Pumping changes the number of a\'s but not the number of b\'s.', name: 'aⁿbⁿ, n ≥ 0', sigma: ['a', 'b'], test: (s) => /^a*b*$/.test(s) && count(s, 'a') === count(s, 'b'), pick: (p) => 'a'.repeat(p) + 'b'.repeat(p), w: 'aᵖbᵖ' },
    anbm: { why: 'y holds only a\'s, so xy²z has more a\'s than b\'s.', name: 'aⁿbᵐ, n ≤ m', sigma: ['a', 'b'], test: (s) => /^a*b*$/.test(s) && count(s, 'a') <= count(s, 'b'), pick: (p) => 'a'.repeat(p) + 'b'.repeat(p), w: 'aᵖbᵖ' },
    eqab: { why: 'y holds only a\'s, so pumping changes the a count but not the b count.', name: 'equal numbers of a and b', sigma: ['a', 'b'], test: (s) => count(s, 'a') === count(s, 'b'), pick: (p) => 'a'.repeat(p) + 'b'.repeat(p), w: 'aᵖbᵖ' },
    wwr: { why: 'y lies in the first block of a\'s, so pumping makes the two sides of bb unequal.', name: 'wwᴿ, w ∈ {a,b}*', sigma: ['a', 'b'], test: (s) => s.length % 2 === 0 && s === rev(s), pick: (p) => 'a'.repeat(p) + 'bb' + 'a'.repeat(p), w: 'aᵖbbaᵖ' },
    pal: { why: 'y lies in the first block of a\'s, so after pumping the string no longer reads the same backwards.', name: 'palindromes over {a,b}', sigma: ['a', 'b'], test: (s) => s === rev(s), pick: (p) => 'a'.repeat(p) + 'b' + 'a'.repeat(p), w: 'aᵖbaᵖ' },
    ww: { why: 'y lies in the first half, so pumping makes the two halves different.', name: 'ww, w ∈ {a,b}*', sigma: ['a', 'b'], test: (s) => s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2), pick: (p) => 'a'.repeat(p) + 'b' + 'a'.repeat(p) + 'b', w: 'aᵖbaᵖb' },
    anbncn: { why: 'y holds only a\'s, so pumping changes the a count while the b and c counts stay the same.', name: 'aⁿbⁿcⁿ', sigma: ['a', 'b', 'c'], test: (s) => /^a*b*c*$/.test(s) && count(s, 'a') === count(s, 'b') && count(s, 'b') === count(s, 'c'), pick: (p) => 'a'.repeat(p) + 'b'.repeat(p) + 'c'.repeat(p), w: 'aᵖbᵖcᵖ' },
    square: { why: 'With |w| = p², pumping once gives a length between p² + 1 and p² + p, which lies strictly between p² and (p + 1)², so it is not a square.', name: 'aⁿ where n is a perfect square', sigma: ['a'], test: (s) => /^a*$/.test(s) && Number.isInteger(Math.sqrt(s.length)), pick: (p) => 'a'.repeat(p * p), w: 'a^(p²)' },
    prime: { why: 'With |w| = q and |y| = k, the string xy^(q+1)z has length q + qk = q(1 + k), which is not prime. A smaller i often works too.', name: 'aⁿ where n is prime', sigma: ['a'], test: (s) => /^a*$/.test(s) && isPrime(s.length), pick: (p) => { let q = Math.max(p + 2, 2); while (!isPrime(q)) q++; return 'a'.repeat(q); }, w: 'a^q, q the first prime ≥ p + 2' },
    paren: { why: 'y holds only opening parentheses, so pumping leaves them unbalanced.', name: 'balanced parentheses', sigma: ['(', ')'], test: (s) => { let d = 0; for (const c of s) { if (c === '(') d++; else if (c === ')') { d--; if (d < 0) return false; } else return false; } return d === 0; }, pick: (p) => '('.repeat(p) + ')'.repeat(p), w: '(ᵖ)ᵖ' }
  };
  const PUMPS = [0, 1, 2, 3, 4, 5];

  // Every split w = xyz with |xy| ≤ p and |y| ≥ 1, and the first i for which xyⁱz leaves L.
  function pumpSplits(test, w, p) {
    const rows = [];
    for (let j = 1; j <= Math.min(p, w.length); j++) {
      for (let k = 0; k < j; k++) {
        const x = w.slice(0, k), y = w.slice(k, j), z = w.slice(j);
        const results = PUMPS.map((i) => ({ i, s: x + y.repeat(i) + z, inL: test(x + y.repeat(i) + z) }));
        const fail = results.find((r) => !r.inL);
        rows.push({ x, y, z, results, failsAt: fail ? fail.i : null });
      }
    }
    return { rows, pumpable: rows.filter((r) => r.failsAt === null) };
  }

  // Runs the adversary game for a non-regular language: for each p in 1..maxP, does w = pick(p) defeat every split?
  function pumpingGame(key, p, wOverride, maxP = 8) {
    const L = LANGUAGES[key];
    if (!L) throw new Error('Unknown language.');
    const w = wOverride !== undefined && wOverride !== '' ? wOverride : L.pick(p);
    if ([...w].some((c) => !L.sigma.includes(c))) throw new Error(`"${w}" uses a symbol outside {${L.sigma.join(', ')}}.`);
    const problems = [];
    if (!L.test(w)) problems.push(`"${w}" is not in the language, so it cannot be used.`);
    if (w.length < p) problems.push(`|w| = ${w.length} is shorter than p = ${p}.`);
    const res = pumpSplits(L.test, w, p);
    const sweep = [];
    for (let q = 1; q <= maxP; q++) { const wq = L.pick(q); sweep.push({ p: q, w: wq, defeated: pumpSplits(L.test, wq, q).pumpable.length === 0 }); }
    return { L, w, p, problems, ...res, sweep };
  }

  // Regular language: p = number of states of the minimal DFA, and the split found by the pigeonhole principle.
  function pumpingRegular(reText, w) {
    const ast = DT.regex.parse(reText);
    const nfa = DT.fa.thompson(ast).fa;
    const m = DT.fa.minimize(DT.fa.subset(nfa).fa);
    const dfa = m.min;
    const p = dfa.n;
    const test = (s) => DT.fa.accepts(dfa, s).ok;
    const A = DT.fa.alphabetOf(dfa);
    if ([...w].some((c) => !A.includes(c))) throw new Error(`"${w}" uses a symbol outside Σ = {${A.join(', ')}}.`);
    const problems = [];
    if (!test(w)) problems.push(`"${w}" is not in L(${reText}).`);
    if (w.length < p) problems.push(`|w| = ${w.length} is shorter than p = ${p}. Use a string with at least ${p} symbols.`);
    // walk the DFA and record the state sequence
    const T = new Map(dfa.trans.map((t) => [t.from + '|' + t.sym, t.to]));
    const seq = [dfa.start];
    for (const c of w) seq.push(T.get(seq[seq.length - 1] + '|' + c));
    let split = null;
    const seen = new Map();
    for (let i = 0; i <= Math.min(p, w.length); i++) {
      if (seen.has(seq[i])) { const k = seen.get(seq[i]); split = { x: w.slice(0, k), y: w.slice(k, i), z: w.slice(i), from: k, to: i, state: dfa.labels[seq[i]] }; break; }
      seen.set(seq[i], i);
    }
    const res = pumpSplits(test, w, p);
    const check = split ? PUMPS.map((i) => ({ i, s: split.x + split.y.repeat(i) + split.z, inL: test(split.x + split.y.repeat(i) + split.z) })) : [];
    return { dfa, p, w, problems, seq: seq.map((s) => dfa.labels[s]), split, check, ...res };
  }

  // ---------- grammars as { start, nts, prods: [{lhs, rhs}] } with token symbols ----------
  const P = () => DT.parsing;
  function mk(start, nts, prods) {
    const used = new Set();
    for (const p of prods) { used.add(p.lhs); for (const s of p.rhs) if (nts.includes(s)) used.add(s); }
    const order = nts.filter((n) => used.has(n) || n === start);
    const ntSet = new Set(order);
    const terms = [];
    for (const p of prods) for (const s of p.rhs) if (!ntSet.has(s) && !terms.includes(s)) terms.push(s);
    return { start, nts: order, ntSet, terms, prods, warnings: [] };
  }
  const isN = (G, s) => G.ntSet.has(s);
  const dedupe = (prods) => { const seen = new Set(); return prods.filter((p) => { const k = p.lhs + '→' + p.rhs.join(' '); if (seen.has(k)) return false; seen.add(k); return true; }); };

  function nullableSet(G) {
    const N = new Set();
    for (let ch = true; ch;) { ch = false; for (const p of G.prods) if (!N.has(p.lhs) && p.rhs.every((s) => N.has(s))) { N.add(p.lhs); ch = true; } }
    return N;
  }
  function generatingSet(G) {
    const Gn = new Set();
    for (let ch = true; ch;) { ch = false; for (const p of G.prods) if (!Gn.has(p.lhs) && p.rhs.every((s) => !isN(G, s) || Gn.has(s))) { Gn.add(p.lhs); ch = true; } }
    return Gn;
  }

  function removeUseless(G) {
    const gen = generatingSet(G);
    const nonGen = G.nts.filter((A) => !gen.has(A));
    let prods = G.prods.filter((p) => gen.has(p.lhs) && p.rhs.every((s) => !isN(G, s) || gen.has(s)));
    const reach = new Set([G.start]);
    for (let ch = true; ch;) { ch = false; for (const p of prods) if (reach.has(p.lhs)) for (const s of p.rhs) if (isN(G, s) && !reach.has(s)) { reach.add(s); ch = true; } }
    const unreach = G.nts.filter((A) => gen.has(A) && !reach.has(A));
    prods = prods.filter((p) => reach.has(p.lhs));
    return { G: mk(G.start, G.nts, prods), nonGen, unreach, empty: !gen.has(G.start) };
  }

  function removeLambda(G) {
    const N = nullableSet(G);
    const out = [];
    for (const p of G.prods) {
      const idx = p.rhs.map((s, i) => (N.has(s) ? i : -1)).filter((i) => i >= 0);
      const lim = Math.min(idx.length, 12);
      for (let mask = 0; mask < 1 << lim; mask++) {
        const drop = new Set(idx.filter((_, b) => mask & (1 << b)));
        const rhs = p.rhs.filter((_, i) => !drop.has(i));
        if (rhs.length) out.push({ lhs: p.lhs, rhs });
      }
    }
    return { G: mk(G.start, G.nts, dedupe(out)), nullable: [...N], startNullable: N.has(G.start) };
  }

  function removeUnit(G) {
    const unit = (p) => p.rhs.length === 1 && isN(G, p.rhs[0]);
    const pairs = [];
    for (const A of G.nts) {
      const reach = new Set([A]), st = [A];
      while (st.length) { const B = st.pop(); for (const p of G.prods) if (p.lhs === B && unit(p) && !reach.has(p.rhs[0])) { reach.add(p.rhs[0]); st.push(p.rhs[0]); } }
      for (const B of reach) if (B !== A) pairs.push([A, B]);
    }
    const out = G.prods.filter((p) => !unit(p));
    for (const [A, B] of pairs) for (const p of G.prods) if (p.lhs === B && !unit(p)) out.push({ lhs: A, rhs: [...p.rhs] });
    return { G: mk(G.start, G.nts, dedupe(out)), pairs };
  }

  function toCNF(G, reserved = []) {
    const used = new Set([...G.nts, ...G.terms, ...reserved]);
    const chains = new Map();
    const fresh = (base) => { let n = base, k = 1; while (used.has(n)) n = base + k++; used.add(n); return n; };
    const termVar = new Map();
    const tv = (a) => {
      if (!termVar.has(a)) termVar.set(a, fresh(/^[a-z]$/.test(a) ? 'B' + a : /^[a-z0-9]+$/i.test(a) ? 'B' + a[0].toUpperCase() + a.slice(1) : 'B'));
      return termVar.get(a);
    };
    const nts = [...G.nts];
    const prods = [];
    const extra = [];
    for (const p of G.prods) {
      if (p.rhs.length === 1) { prods.push(p); continue; }
      const syms = p.rhs.map((s) => (isN(G, s) ? s : tv(s)));
      let lhs = p.lhs;
      let rest = syms;
      while (rest.length > 2) {
        const tail = rest.slice(1), key = tail.join(' ');
        if (chains.has(key)) { prods.push({ lhs, rhs: [rest[0], chains.get(key)] }); rest = null; break; }
        const D = fresh('D');
        chains.set(key, D);
        nts.push(D);
        prods.push({ lhs, rhs: [rest[0], D] });
        extra.push(D);
        lhs = D; rest = tail;
      }
      if (rest) prods.push({ lhs, rhs: rest });
    }
    for (const [a, B] of termVar) { nts.push(B); prods.push({ lhs: B, rhs: [a] }); }
    return { G: mk(G.start, nts, dedupe(prods)), termVar: [...termVar], chain: extra };
  }

  // Linz order: λ-productions, unit productions, useless symbols, then CNF.
  function simplifyCNF(G0) {
    const G = mk(G0.start, G0.nts, G0.prods.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] })));
    const s1 = removeLambda(G);
    const s2 = removeUnit(s1.G);
    const s3 = removeUseless(s2.G);
    const s4 = toCNF(s3.G, G0.nts);
    return { lambda: s1, unit: s2, useless: s3, cnf: s4 };
  }
  const isCNF = (G) => G.prods.every((p) => (p.rhs.length === 1 && !isN(G, p.rhs[0])) || (p.rhs.length === 2 && p.rhs.every((s) => isN(G, s))));

  // ---------- NPDA → CFG (Linz 7.2) ----------
  // Puts the NPDA in Linz's form (one final state, entered only with an empty stack; every move pops one
  // symbol and pushes zero or two), then builds variables [qi A qj] = "from qi, A is popped and we reach qj".
  function pdaToCfg(pda, mode = 'final') {
    const states = new Set([pda.start]);
    const stack = new Set([pda.z]);
    pda.trans.forEach((t) => { states.add(t.from); states.add(t.to); if (t.pop !== EPS) stack.add(t.pop); t.push.forEach((s) => stack.add(s)); });
    (pda.finals || []).forEach((f) => states.add(f));
    const bad = pda.trans.filter((t) => t.pop === EPS);
    if (bad.length) throw new Error(`Linz's construction needs every move to pop a stack symbol; ${bad.length} move(s) pop λ.`);
    const takenS = new Set(states), takenG = new Set(stack);
    const freshS = (b) => { let n = b, k = 1; while (takenS.has(n)) n = b + k++; takenS.add(n); return n; };
    const freshG = (b) => { let n = b, k = 1; while (takenG.has(n)) n = b + k++; takenG.add(n); return n; };
    const notes = [];
    const T = [];
    const q0 = freshS('qs'), qf = freshS('qf'), Z0 = freshG('Z0');
    T.push({ from: q0, inp: EPS, pop: Z0, to: pda.start, push: [pda.z, Z0], why: `new start: put ${Z0} under ${pda.z} so the stack can be emptied safely` });
    for (const t of pda.trans) {
      if (t.push.length === 0 || t.push.length === 2) { T.push({ ...t, why: 'already in Linz form' }); continue; }
      if (t.push.length === 1) {
        const r = freshS('r'), D = freshG('D');
        T.push({ from: t.from, inp: t.inp, pop: t.pop, to: r, push: [D, t.push[0]], why: `push ${D}${t.push[0]} (dummy ${D} on top), then pop ${D}` });
        T.push({ from: r, inp: EPS, pop: D, to: t.to, push: [], why: `pop dummy ${D}` });
        notes.push(`δ(${t.from}, ${t.inp}, ${t.pop}) ∋ (${t.to}, ${t.push.join('')}) replaces one symbol, so it becomes two moves through ${r}.`);
        continue;
      }
      // push B1…Bn (n > 2): build the stack bottom-up with a marker Y
      const n = t.push.length, Y = freshG('Y');
      let cur = t.from, inp = t.inp, pop = t.pop;
      for (let k = n - 1; k >= 1; k--) {
        const r = freshS('r');
        T.push({ from: cur, inp, pop, to: r, push: [Y, t.push[k]], why: `push ${t.push[k]} under marker ${Y}` });
        cur = r; inp = EPS; pop = Y;
      }
      const r = freshS('r'), D = freshG('D');
      T.push({ from: cur, inp: EPS, pop: Y, to: r, push: [D, t.push[0]], why: `replace ${Y} by ${t.push[0]} (dummy ${D} on top)` });
      T.push({ from: r, inp: EPS, pop: D, to: t.to, push: [], why: `pop dummy ${D}` });
      notes.push(`δ(${t.from}, ${t.inp}, ${t.pop}) ∋ (${t.to}, ${t.push.join('')}) pushes ${n} symbols, so it is split into ${n + 1} moves.`);
    }
    const allStack = [...takenG];
    if (mode === 'final') {
      const d = freshS('qd');
      for (const f of pda.finals) {
        for (const X of allStack) if (X !== Z0) T.push({ from: f, inp: EPS, pop: X, to: d, push: [], why: `final ${f}: start emptying the stack` });
        T.push({ from: f, inp: EPS, pop: Z0, to: qf, push: [], why: 'stack already empty: accept' });
      }
      for (const X of allStack) if (X !== Z0) T.push({ from: d, inp: EPS, pop: X, to: d, push: [], why: 'empty the stack' });
      T.push({ from: d, inp: EPS, pop: Z0, to: qf, push: [], why: `bottom marker reached: go to ${qf}` });
      notes.push(`Acceptance by final state is turned into "reach ${qf} with an empty stack" through a draining state ${d}.`);
    } else {
      for (const q of takenS) if (q !== qf && q !== q0) T.push({ from: q, inp: EPS, pop: Z0, to: qf, push: [], why: `stack empty: go to ${qf}` });
      notes.push(`Acceptance by empty stack: whenever only ${Z0} is left, move to ${qf}.`);
    }
    const Q = [...takenS];
    const V = (a, X, b) => `[${a} ${X} ${b}]`;
    const prods = [];
    for (const t of T) {
      const a = t.inp === EPS ? [] : [t.inp];
      if (t.push.length === 0) prods.push({ lhs: V(t.from, t.pop, t.to), rhs: a, from: t });
      else for (const qk of Q) for (const ql of Q) prods.push({ lhs: V(t.from, t.pop, qk), rhs: [...a, V(t.to, t.push[0], ql), V(ql, t.push[1], qk)], from: t });
    }
    const start = V(q0, Z0, qf);
    // internal names so the grammar tools can work on it
    const names = new Map();
    const nm = (v) => { if (!names.has(v)) names.set(v, 'V' + names.size); return names.get(v); };
    nm(start);
    const isVar = (s) => s.startsWith('[');
    const internal = prods.map((p) => ({ lhs: nm(p.lhs), rhs: p.rhs.map((s) => (isVar(s) ? nm(s) : s)) }));
    const allNames = [...names.values()];
    const full = mk(nm(start), allNames, internal);
    const trimmed = removeUseless(full);
    const back = new Map([...names].map(([k, v]) => [v, k]));
    return { moves: T, notes, Q, Z0, q0, qf, start, prods, full, trimmed: trimmed.G, display: (s) => back.get(s) || s, empty: trimmed.empty };
  }

  DT.theory = { LANGUAGES, pumpSplits, pumpingGame, pumpingRegular, nullableSet, generatingSet, removeLambda, removeUnit, removeUseless, toCNF, simplifyCNF, isCNF, pdaToCfg, mk };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
