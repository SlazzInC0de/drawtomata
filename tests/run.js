// Run with: node tests/run.js  (or npm test)
// Loads the browser modules into one context and checks the conversions against each other.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ctx = vm.createContext({ console });
for (const f of ['regex.js', 'automata.js', 'grammar.js', 'parsing.js', 'theory.js', 'codegen.js', 'sdt.js', 'lex.js', 'phases.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { regex, fa, grammar, parsing: P, theory: TH } = ctx.DT;

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message}`); }
}
const nfa = (n, start, finals, t) => ({ n, start, finals: new Set(finals), labels: [...Array(n).keys()].map((i) => 'q' + i), trans: t.map(([from, sym, to]) => ({ from, sym, to })) });
const fromRE = (s) => fa.thompson(regex.parse(s)).fa;
const same = (a, b, msg) => { const r = fa.equivalent(a, b); assert.ok(r.eq, `${msg}: differ on "${r.witness}"`); };
const accepts = (m, w) => fa.accepts(m, w).ok;

const REs = ['(a+b)*abb', '(0+1)*01', 'a*b*', '(ab+ba)*', 'a(a+b)*b', 'λ', '∅', '(a+λ)(b+λ)', '((aab)*ab)*', 'a*+b*', '(a*b*)*', 'ab*(c+λ)'];

for (const re of REs) {
  test(`pipeline ${re}`, () => {
    const e = fromRE(re);
    const n = fa.removeEps(e).fa;
    const d = fa.subset(e).fa;
    const m = fa.minimize(d);
    same(e, n, 'λ-removal');
    same(e, d, 'subset');
    same(e, m.min, 'minimize');
    assert.ok(fa.isDFA(m.min), 'minimal automaton is deterministic');
    assert.equal(m.partitions[m.partitions.length - 1].length, m.min.n, 'π-partition and mark table agree on state count');
    same(e, fromRE(fa.toRegex(m.min).regex), 'FA → RE round trip');
  });
}

test('known minimal sizes', () => {
  assert.equal(fa.minimize(fa.subset(fromRE('(a+b)*abb')).fa).min.n, 4);
  assert.equal(fa.minimize(fa.subset(fromRE('(0+1)*01')).fa).min.n, 3);
  assert.equal(fa.minimize(fa.subset(fromRE('a*b*')).fa).min.n, 3);
});

test('regex parser rejects bad input', () => {
  assert.throws(() => regex.parse('(a+b'));
  assert.throws(() => regex.parse('a+'));
  assert.throws(() => regex.parse('a)'));
  assert.throws(() => regex.parse(''));
});

test('state elimination on even number of a', () => {
  const even = nfa(2, 0, [0], [[0, 'b', 0], [0, 'a', 1], [1, 'b', 1], [1, 'a', 0]]);
  assert.equal(fa.toRegex(even).regex, '(b+ab*a)*');
});

test('FA → grammars and back', () => {
  const m = nfa(5, 0, [4], [[0, 'a', 1], [0, 'b', 2], [1, 'a', 1], [1, 'b', 3], [2, 'a', 1], [2, 'b', 2], [3, 'a', 1], [3, 'b', 4], [4, 'a', 1], [4, 'b', 2]]);
  const text = (prods) => prods.map((p) => `${p.lhs} -> ${p.rhs.join(' | ')}`).join('\n');
  const rl = grammar.parse(text(fa.toRightLinear(m).prods));
  const ll = grammar.parse(text(fa.toLeftLinear(m).prods));
  assert.ok(grammar.classify(rl).right);
  assert.ok(grammar.classify(ll).left && !grammar.classify(ll).right);
  same(m, grammar.regularToNFA(rl).fa, 'right-linear');
  same(m, grammar.regularToNFA(ll).fa, 'left-linear');
});

test('regular grammars from the slides', () => {
  same(grammar.regularToNFA(grammar.parse('S -> abA\nA -> baB\nB -> aA | bb')).fa, fromRE('abba(aba)*bb'), 'Linz 3.3');
  same(grammar.regularToNFA(grammar.parse('S -> Aab\nA -> Aab | B\nB -> a')).fa, fromRE('a(ab)*ab'), 'left-linear');
  assert.throws(() => grammar.regularToNFA(grammar.parse('S -> aSb | λ')));
});

test('language builder matches its description', () => {
  const A = ['a', 'b'];
  const all = (n) => { let out = ['']; for (let i = 0; i < n; i++) out = out.concat(out.filter((s) => s.length === i).flatMap((s) => A.map((c) => s + c))); return out; };
  const cases = [
    [{ type: 'starts', w: 'ab' }, (s) => s.startsWith('ab')],
    [{ type: 'ends', w: 'abb' }, (s) => s.endsWith('abb')],
    [{ type: 'contains', w: 'aba' }, (s) => s.includes('aba')],
    [{ type: 'countmod', x: 'a', m: 3, r: 1 }, (s) => [...s].filter((c) => c === 'a').length % 3 === 1],
    [{ type: 'lenmod', m: 2, r: 0 }, (s) => s.length % 2 === 0],
    [{ type: 'nthright', x: 'a', m: 3 }, (s) => s.length >= 3 && s[s.length - 3] === 'a'],
    [{ type: 'countcmp', x: 'b', m: 2, cmp: 'le' }, (s) => [...s].filter((c) => c === 'b').length <= 2]
  ];
  for (const [c, pred] of cases) {
    const d = fa.buildCondition(c, A);
    for (const s of all(8)) assert.equal(accepts(d, s), pred(s), `${c.type} on "${s}"`);
  }
  const both = fa.product(fa.buildCondition({ type: 'starts', w: 'a' }, A), fa.buildCondition({ type: 'ends', w: 'b' }, A), 'and', A);
  same(both, fromRE('a(a+b)*b'), 'product AND');
  same(fa.complementDFA(fa.buildCondition({ type: 'contains', w: 'ab' }, A), A), fromRE('b*a*'), 'complement');
});

test('CFG derivations and ambiguity', () => {
  const E = grammar.parse('E -> E+E | E*E | (E) | a');
  assert.equal(grammar.derive(E, 'a+a*a').derivs.length, 2);
  assert.ok(grammar.findAmbiguity(E, 5).found);
  const S = grammar.parse('S -> aSb | λ');
  assert.equal(grammar.enumerate(S, 6).list.join(','), ',ab,aabb,aaabbb');
  assert.equal(grammar.findAmbiguity(S, 6).found, false);
  const r = grammar.replay(S, grammar.derive(S, 'aabb').derivs[0]);
  assert.equal(r.forms.map((f) => f.form).join(' => '), 'S => aSb => aaSbb => aabb');
  assert.equal(grammar.derive(S, 'aab').derivs.length, 0);
});

test('CFG → NPDA accepts exactly L(G)', () => {
  const g1 = grammar.parse('S -> aAA\nA -> aB | a | bB\nB -> c');
  assert.ok(grammar.isGNF(g1));
  const p1 = grammar.cfgToPDA(g1);
  for (const w of grammar.enumerate(g1, 5).list) assert.ok(grammar.simulatePDA(p1, w).accepted, w);
  assert.equal(grammar.simulatePDA(p1, 'aac').accepted, false);
  const g2 = grammar.parse('E -> E+E | (E) | a');
  const p2 = grammar.cfgToPDA(g2);
  assert.ok(!p2.gnf);
  assert.ok(grammar.simulatePDA(p2, '(a+a)+a').accepted);
  assert.equal(grammar.simulatePDA(p2, 'a+').accepted, false);
});

test('NPDA text format', () => {
  const t = grammar.parsePDA('δ(q0, a, z) = {(q0, az)}\nδ(q0, a, a) = {(q0, aa)}\nδ(q0, b, a) = {(q1, λ)}\nδ(q1, b, a) = {(q1, λ)}\nδ(q1, λ, z) = {(qf, z)}');
  const pda = { start: 'q0', z: 'z', finals: ['qf'], trans: t };
  assert.ok(grammar.simulatePDA(pda, 'aabb').accepted);
  assert.equal(grammar.simulatePDA(pda, 'aab').accepted, false);
});


// ---------- syntax analysis ----------
const setOf = (m, k) => [...m.get(k)].sort().join(' ');
test('FIRST and FOLLOW of the LL expression grammar (Aho 4.4)', () => {
  const G = P.parseGrammar("E -> TE'\nE' -> +TE' | ε\nT -> FT'\nT' -> *FT' | ε\nF -> (E) | id");
  const ff = P.firstFollow(G);
  assert.equal(setOf(ff.FIRST, 'E'), '( id');
  assert.equal(setOf(ff.FOLLOW, 'E'), '$ )');
  assert.equal(setOf(ff.FOLLOW, 'T'), '$ ) +');
  assert.equal(setOf(ff.FOLLOW, 'F'), '$ ) * +');
  const t = P.ll1(G);
  assert.ok(t.isLL1);
  assert.ok(P.predictiveParse(G, t, P.tokenizeInput('id + id * id', G)).accepted);
  assert.ok(P.recursiveTrace(G, t, P.tokenizeInput('(id)*id', G)).accepted);
  assert.ok(P.checkRecognizer(G, (w) => P.predictiveParse(G, t, w).accepted).ok);
});

test('left recursion removal, direct and indirect', () => {
  const G = P.parseGrammar('E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id');
  const r = P.removeLeftRecursion(G);
  assert.equal(r.remaining.length, 0);
  assert.equal(P.grammarText(r.G).split('\n')[0], "E -> T E'");
  assert.ok(P.ll1(r.G).isLL1);
  const G2 = P.parseGrammar('S -> A a | b\nA -> A c | S d | ε');
  const r2 = P.removeLeftRecursion(G2);
  assert.equal(r2.remaining.length, 0);
  assert.equal(P.grammarText(r2.G).split('\n')[1], "A -> b d A' | A'");
});

test('left factoring', () => {
  const r = P.leftFactor(P.parseGrammar('S -> i E t S | i E t S e S | a\nE -> b'));
  assert.equal(P.grammarText(r.G).split('\n').slice(0, 2).join(' / '), "S -> i E t S S' | a / S' -> e S | ε".replace('ε', ctx.DT.EPS));
  assert.equal(P.ll1(r.G).conflicts.length, 1, 'dangling else stays non-LL(1)');
});

const lrAll = (text) => {
  const G = P.parseGrammar(text), GA = P.augment(G), ff = P.firstFollow(GA);
  const c0 = P.lr0Collection(GA), c1 = P.lr1Collection(GA, ff), la = P.lalrFromLr1(GA, c1);
  return { G, GA, c0, c1, la, slr: P.lrTable(GA, c0, 'slr', ff), clr: P.lrTable(GA, c1, 'clr'), lalr: P.lrTable(GA, la, 'lalr') };
};
test('LR state counts and conflicts match the textbook', () => {
  const e = lrAll('E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id');
  assert.equal(e.c0.states.length, 12);
  assert.equal(e.slr.conflicts.length, 0);
  assert.ok(P.checkRecognizer(e.G, (w) => P.lrParse(e.GA, e.slr, w).accepted).ok);
  const s = lrAll('S -> C C\nC -> c C | d');
  assert.equal(s.c1.states.length, 10);
  assert.equal(s.la.states.length, 7);
  const l = lrAll('S -> L = R | R\nL -> * R | id\nR -> L');
  assert.equal(l.slr.conflicts.length, 1);
  assert.equal(l.slr.conflicts[0].a, '=');
  assert.equal(l.lalr.conflicts.length, 0);
  assert.ok(P.checkRecognizer(l.G, (w) => P.lrParse(l.GA, l.lalr, w).accepted).ok);
});

test('precedence declarations resolve the ambiguous expression grammar', () => {
  const a = lrAll('E -> E + E | E * E | ( E ) | id');
  assert.equal(a.slr.conflicts.length, 4);
  const prec = P.parsePrecedence('%left +\n%left *');
  const r = P.resolveConflicts(a.GA, a.slr, prec);
  assert.equal(r.conflicts.length, 0);
  const trace = P.lrParse(a.GA, r, P.tokenizeInput('id+id*id', a.G));
  const reductions = trace.rows.filter((x) => x.handle).map((x) => x.handle).join(' | ');
  assert.equal(reductions, 'id | id | id | E * E | E + E');
  const op = P.operatorPrecedence(a.G, prec);
  assert.ok(op.ok && op.conflicts.length === 0);
  assert.ok(P.opPrecParse(op, P.tokenizeInput('id+id*id', a.G)).accepted);
  const d = P.disambiguate(a.G, prec);
  const dl = lrAll(P.grammarText(d.G));
  assert.equal(dl.lalr.conflicts.length, 0);
});


// ---------- pumping lemma, simplification, NPDA → CFG ----------
test('pumping lemma: the standard w beats every split for non-regular languages', () => {
  for (const key of Object.keys(TH.LANGUAGES)) {
    for (let p = 1; p <= 6; p++) {
      const g = TH.pumpingGame(key, p);
      assert.ok(!g.problems || g.problems.length === 0, `${key} p=${p}: ${(g.problems || []).join(' ')}`);
      assert.equal(g.pumpable.length, 0, `${key} p=${p}: a split survives`);
    }
  }
});

test('pumping lemma: regular languages always have a pumpable split', () => {
  for (const [re, w] of [['(a+b)*abb', 'aababb'], ['a*b*', 'aabbb'], ['(ab)*', 'abababab']]) {
    const r = TH.pumpingRegular(re, w);
    assert.ok(r.split, `no repeated state for ${re}`);
    assert.ok(r.check.every((c) => c.inL), `split for ${re} does not pump`);
  }
});

const sameExceptEps = (G1, G2) => {
  const a = new Set(P.enumerate(G1, 6).list.map((x) => x.join(' ')).filter(Boolean));
  const b = new Set(P.enumerate(G2, 6).list.map((x) => x.join(' ')));
  return [...a].every((x) => b.has(x)) && [...b].every((x) => a.has(x));
};
test('simplification and Chomsky normal form keep the language', () => {
  for (const text of ['S -> A B a C\nA -> B C\nB -> b | ε\nC -> D | ε\nD -> d', 'S -> a S b | S S | ε', 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id']) {
    const G = P.parseGrammar(text);
    const r = TH.simplifyCNF(G);
    assert.ok(TH.isCNF(r.cnf.G), `not CNF for ${text}`);
    assert.ok(sameExceptEps(G, r.cnf.G), `language changed for ${text}`);
  }
});

test('NPDA → CFG generates exactly what the NPDA accepts', () => {
  const check = (pda, mode) => {
    const r = TH.pdaToCfg(pda, mode);
    const L = new Set(P.enumerate(r.trimmed, 6).list.map((x) => x.join('')));
    const sigma = [...new Set(pda.trans.map((t) => t.inp).filter((a) => a && a !== 'λ' && a !== 'ε'))];
    let all = [''];
    for (let i = 0; i < 4; i++) all = all.concat(all.filter((s) => s.length === i).flatMap((s) => sigma.map((c) => s + c)));
    for (const w of all) assert.equal(L.has(w), grammar.simulatePDA(pda, w, mode).accepted, `${mode}: disagree on "${w}"`);
  };
  const g = grammar.cfgToPDA(grammar.parse('S -> aSb | ab'));
  check(g, 'final');
  check(g, 'empty');
  check(grammar.cfgToPDA(grammar.parse('S -> aSa | bSb | c')), 'final');
});

test('left-linear grammar keeps a variable apart from a digit that follows it', () => {
  // contains 01 over {0, 1}: S -> B1 must not be read as the variable B1
  const f = { n: 3, start: 0, finals: new Set([2]), labels: ['q0', 'q1', 'q2'], trans: [[0, '1', 0], [0, '0', 1], [1, '0', 1], [1, '1', 2], [2, '0', 2], [2, '1', 2]].map(([a, s, b]) => ({ from: a, sym: s, to: b })) };
  const r = fa.toLeftLinear(f);
  const text = r.prods.map((p) => `${p.lhs} -> ${p.rhs.join(' | ')}`).join('\n');
  assert.ok(fa.equivalent(f, grammar.regularToNFA(grammar.parse(text)).fa).eq, text);
});

// ---------- code generation ----------
const CG = ctx.DT.codegen;
const plain = (x) => JSON.parse(JSON.stringify(x));
const AHO_LOOPS = '1) i = 1\n2) j = 1\n3) t1 = 10 * i\n4) t2 = t1 + j\n5) t3 = 8 * t2\n6) t4 = t3 - 88\n7) a[t4] = 0\n8) j = j + 1\n9) if j <= 10 goto (3)\n10) i = i + 1\n11) if i <= 10 goto (2)\n12) i = 1\n13) t5 = i - 1\n14) t6 = 88 * t5\n15) a[t6] = 1\n16) i = i + 1\n17) if i <= 10 goto (13)';
const CG_PROGRAMS = [
  'a = b * -c + b * -c',
  'x = (a + b) * (a + b) - c / (a + b)',
  'a = b + c\nb = a - d\nc = b + c\nd = a - d',
  'p = a + b\nq = p - c\np = q * d\np = e - p\nq = p + q',
  'x = a[i] + a[j]\nif x > 0 goto L1\ny = 0 - x\ngoto L2\nL1: y = x\nL2: z = y * 2',
  AHO_LOOPS,
  't = a - b\nu = a - c\nv = t + u\na = d\nd = v + u',
  'if debug == 1 goto L1\ngoto L2\nL1: x = x * 1\ny = y * 2\nL2: i = i + 1\ngoto L3\nk = 0\nL3: goto L4\nL4: n = 4 * 2',
  'a[i] = b\nc = a[j]\na[k] = c + 0\nd = a[j] * 1\ne = 3 * 4 + d'
];

test('three-address code follows Aho 6.2 for a = b * -c + b * -c', () => {
  const p = CG.parseProgram('a = b * -c + b * -c');
  assert.deepEqual(plain(p.ins.map((x) => CG.insStr(x))), ['t1 = minus c', 't2 = b * t1', 't3 = minus c', 't4 = b * t3', 't5 = t2 + t4', 'a = t5']);
  const r = CG.representations(p);
  assert.deepEqual(plain(r.quads[1]), ['*', 'b', 't1', 't2']);
  assert.deepEqual(plain(r.triples[4].slice(0, 3)), ['+', '(1)', '(3)']);
  assert.deepEqual(plain(r.triples[5].slice(0, 3)), ['=', 'a', '(4)']);
});

test('basic blocks, flow graph and loops match Aho 8.4', () => {
  const bb = CG.basicBlocks(CG.parseProgram(AHO_LOOPS).ins);
  assert.deepEqual(plain(bb.leaders.map((i) => i + 1)), [1, 2, 3, 10, 12, 13]);
  assert.deepEqual(plain(bb.blocks.map((b) => b.succ)), [[1], [2], [2, 3], [1, 4], [5], [5, 6]]);
  assert.deepEqual(plain(CG.dominators(bb).loops.map((l) => `${l.from}>${l.head}`).sort()), ['2>2', '3>1', '5>5']);
});

test('DAG optimization finds common subexpressions and keeps the results', () => {
  const p = CG.parseProgram('a = b * -c + b * -c');
  const o = CG.optimize(p);
  assert.equal(o.ins.length, 3);
  for (const text of CG_PROGRAMS) {
    const q = CG.parseProgram(text);
    assert.ok(CG.equivalent(q.ins, CG.optimize(q).ins, { names: CG.observedOf(q) }).ok, text);
  }
  const live = CG.parseProgram('a = b + c\nb = a - d\nc = b + c\nd = a - d');
  live.liveExit = ['a', 'c', 'd'];
  const o2 = CG.optimize(live);
  assert.equal(o2.ins.length, 3, 'b is dead, so Aho 8.10 needs three instructions');
  assert.ok(CG.equivalent(live.ins, o2.ins, { names: CG.observedOf(live) }).ok);
});

test('SSA: one assignment per name, φ at joins, same results', () => {
  const s1 = CG.toSSA(CG.parseProgram('p = a + b\nq = p - c\np = q * d\np = e - p\nq = p + q'));
  assert.deepEqual(plain(s1.blocks[0].ins.map((x) => CG.insStr(x))), ['p₁ = a + b', 'q₁ = p₁ - c', 'p₂ = q₁ * d', 'p₃ = e - p₂', 'q₂ = p₃ + q₁']);
  const counts = { [CG_PROGRAMS[4]]: 1, [AHO_LOOPS]: 3 };
  for (const text of CG_PROGRAMS) {
    const p = CG.parseProgram(text), s = CG.toSSA(p);
    assert.ok(s.single, text);
    assert.ok(CG.checkSSA(p, s).ok, text);
    if (text in counts) assert.equal(s.phiCount, counts[text], text);
  }
});

test('next-use information (Aho 8.5.1)', () => {
  const p = CG.parseProgram('t = a - b\nu = a - c\nv = t + u\na = d\nd = v + u');
  const nu = CG.nextUse(p.ins, new Set(['a', 'b', 'c', 'd']));
  assert.deepEqual(plain(nu.rows[0].a), { live: true, next: 1 });
  assert.deepEqual(plain(nu.rows[2].t), { live: false, next: null });
  assert.deepEqual(plain(nu.rows[2].u), { live: true, next: 4 });
});

test('code generator output runs like the three-address code', () => {
  for (const text of CG_PROGRAMS) {
    const p = CG.parseProgram(text);
    for (const n of [2, 3, 4]) {
      const g = CG.generate(p, n);
      assert.ok(CG.checkMachine(p.ins, g.code, 40, CG.observedOf(p)).ok, `${n} registers: ${text}`);
      assert.equal(g.total, g.code.reduce((s, m) => s + CG.mCost(m), 0));
    }
  }
});

test('peephole keeps the results and lowers the cost', () => {
  for (const text of CG_PROGRAMS) {
    const p = CG.parseProgram(text), r = CG.peephole(p), names = CG.observedOf(p);
    assert.ok(CG.equivalent(p.ins, r.tac.ins, { names }).ok, text);
    assert.ok(CG.checkMachine(p.ins, r.after.code, 40, names).ok, text);
    assert.ok(r.costAfter <= r.costBefore, text);
  }
  const r = CG.peephole(CG.parseProgram(CG_PROGRAMS[7]));
  assert.equal(r.tac.ins.length, 4);
  for (const rule of ['Jump over a jump', 'Algebraic identity', 'Strength reduction', 'Jump to a jump', 'Constant folding', 'Unreachable code']) assert.ok(r.tac.log.some((l) => l.rule === rule), rule);
  assert.ok(r.after.log.some((l) => l.rule === 'Machine idiom'));
  const st = CG.peepholeMachine(CG.naiveCode(CG.parseProgram('a = b + c\nd = a + e').ins));
  assert.ok(st.log.some((l) => l.rule === 'Redundant load'), 'ST a, R0; LD R0, a');
});

// ---------- syntax-directed translation ----------
const SDT = ctx.DT.sdt;
const SDD = {
  calc: 'L -> E n { L.val = E.val }\nE -> E1 + T { E.val = E1.val + T.val }\nE -> T { E.val = T.val }\nT -> T1 * F { T.val = T1.val * F.val }\nT -> F { T.val = F.val }\nF -> ( E ) { F.val = E.val }\nF -> digit { F.val = digit.lexval }',
  inh: "T -> F T' { T'.inh = F.val ; T.val = T'.syn }\nT' -> * F T1' { T1'.inh = T'.inh * F.val ; T'.syn = T1'.syn }\nT' -> ε { T'.syn = T'.inh }\nF -> digit { F.val = digit.lexval }",
  decl: 'D -> T L { L.inh = T.type }\nT -> int { T.type = integer }\nT -> float { T.type = float }\nL -> L1 , id { L1.inh = L.inh ; addType(id.entry, L.inh) }\nL -> id { addType(id.entry, L.inh) }',
  tree: "E -> E1 + T { E.node = new Node('+', E1.node, T.node) }\nE -> E1 - T { E.node = new Node('-', E1.node, T.node) }\nE -> T { E.node = T.node }\nT -> ( E ) { T.node = E.node }\nT -> id { T.node = new Leaf(id, id.entry) }\nT -> num { T.node = new Leaf(num, num.val) }",
  postfix: "E -> E1 + T { E.t = E1.t || T.t || '+' }\nE -> E1 - T { E.t = E1.t || T.t || '-' }\nE -> T { E.t = T.t }\nT -> digit { T.t = digit.lexval }",
  notL: 'A -> B C { A.s = B.b ; B.i = C.c + A.s }\nB -> b { B.b = 1 }\nC -> c { C.c = 2 }'
};
const rootVal = (r, attr) => { const I = [...r.res.inst.values()].find((x) => x.node === r.root && x.attr === attr); return I && r.res.show(I.value); };

test('SDT: annotated parse trees match Aho chapter 5', () => {
  const calc = SDT.run(SDD.calc, '3 * 5 + 4 n');
  assert.equal(rootVal(calc, 'val'), '19');
  assert.ok(calc.yieldOk && calc.respects && calc.check.ok);
  assert.equal(rootVal(SDT.run(SDD.calc, '( 1 + 2 ) * 3 n'), 'val'), '9');
  const inh = SDT.run(SDD.inh, '3 * 5');
  assert.equal(rootVal(inh, 'val'), '15');
  assert.ok(inh.check.ok && inh.check.kind === 'dfs');
  assert.equal(rootVal(SDT.run(SDD.postfix, '9 - 5 + 2'), 't'), '95-2+');
  const decl = SDT.run(SDD.decl, 'float a , b , c');
  assert.deepEqual(plain(decl.res.actions.slice().sort()), ['addType(a, float)', 'addType(b, float)', 'addType(c, float)']);
});

test('SDT: syntax tree construction matches Aho figure 5.11', () => {
  const r = SDT.run(SDD.tree, 'a - 4 + c');
  assert.deepEqual(plain(r.res.tree.map((n) => n.call)), ['Leaf(id, a)', 'Leaf(num, 4)', 'Node(-, p1, p2)', 'Leaf(id, c)', 'Node(+, p3, p4)']);
});

test('SDT: S-attributed and L-attributed checks', () => {
  const k = (t) => SDT.classify(SDT.parseSDD(t));
  assert.ok(k(SDD.calc).S && k(SDD.calc).L);
  assert.ok(!k(SDD.inh).S && k(SDD.inh).L);
  assert.ok(!k(SDD.decl).S && k(SDD.decl).L);
  const n = k(SDD.notL);
  assert.ok(!n.S && !n.L && /right of B/.test(n.lFails[0].why));
  const r = SDT.run(SDD.notL, 'b c');
  assert.equal(rootVal(r, 's'), '1');
  assert.ok(!r.check.ok && r.check.stuck, 'one left-to-right pass must not be enough');
});

test('SDT: every evaluation order respects the dependency graph', () => {
  for (const [t, w] of [[SDD.calc, '1 + 2 * 3 + 4 n'], [SDD.inh, '2 * 3 * 4'], [SDD.decl, 'int x , y'], [SDD.tree, '( a + 1 ) - b']]) {
    const r = SDT.run(t, w);
    assert.ok(r.respects && r.check.ok && r.yieldOk, w);
  }
  assert.throws(() => SDT.run(SDD.calc, '3 + n'), /not in the language/);
  assert.throws(() => SDT.run('A -> B { A.x = B.y }\nB -> b { B.z = 1 }', 'b'), /no rule gives it a value/);
  const cyc = SDT.run('A -> B { B.i = B.s ; A.v = B.s }\nB -> b { B.s = B.i }', 'b');
  assert.ok(cyc.res.error && /cycle/.test(cyc.res.error));
});

// ---------- lexical analysis, Lex and Yacc ----------
const LX = ctx.DT.lex;
test('transition diagrams follow Aho figures 3.13 to 3.17', () => {
  const r = (k, w) => LX.runDiagram(k, w);
  assert.deepEqual([r('relop', '<=').attr, r('relop', '<>').attr, r('relop', '<a').attr, r('relop', '>=').attr, r('relop', '>1').attr, r('relop', '=').attr], ['LE', 'NE', 'LT', 'GE', 'GT', 'EQ']);
  assert.ok(r('relop', '<a').retract && !r('relop', '<=').retract);
  assert.equal(r('id', 'x12+y').lexeme, 'x12');
  assert.equal(r('number', '3.14E+5;').lexeme, '3.14E+5');
  assert.equal(r('number', '42)').state, 20);
  assert.equal(r('number', '6.0)').state, 21);
  assert.equal(r('number', '1E-3 ').state, 19);
  assert.ok(r('number', '1.x').fail && r('relop', 'x').fail);
});

test('patterns combine into the DFA of Aho figure 3.54', () => {
  const pats = LX.parsePatterns('a  a\nabb  abb\nab+  a*bb*');
  const c = LX.combine(pats);
  const got = c.names.map((n, i) => `${n}:${c.announce[i] === null ? '-' : pats[c.announce[i]].name}`);
  assert.deepEqual(plain(got.filter((x) => !x.startsWith('∅')).sort()), ['{0,1,3,7}:-', '{2,4,7}:a', '{5,8}:ab+', '{6,8}:abb', '{7}:-', '{8}:ab+']);
  for (const [text, inputs] of [['a  a\nabb  abb\nab+  a*bb*', ['abb', 'aaba', 'abbb', 'babb', 'aabbbab']], ['then  then\nthe  the\nid  (t+h+e+n)(t+h+e+n)*', ['then', 'the', 'thenn', 'tht', 'nethe']]]) {
    const P = LX.parsePatterns(text), C = LX.combine(P);
    for (const w of inputs) {
      const a = LX.scanDFA(C, w), b = LX.scanBrute(P, w);
      assert.equal(JSON.stringify(a.tokens.map((t) => [t.lexeme, t.pat])), JSON.stringify(b.tokens.map((t) => [t.lexeme, t.pat])), w);
    }
  }
  const kw = LX.combine(LX.parsePatterns('then  then\nid  (t+h+e+n)(t+h+e+n)*'));
  assert.equal(LX.scanDFA(kw, 'then').tokens[0].pat, 0, 'a keyword beats an identifier of the same length');
  assert.equal(LX.scanDFA(kw, 'thenn').tokens[0].pat, 1, 'the longer match wins');
});

const C_CODE = '#include <stdio.h>\nint main() {\n  float rate = 3.14E+2, x1; /* c */\n  if (x1 <= rate && x1 != 0) x1 = x1 + 1; // bump\n  printf("sum = %d\\n", x1);\n  return 0;\n}';
test('lexer: token stream and symbol table', () => {
  const r = LX.lexC(C_CODE);
  assert.ok(LX.covers(C_CODE, r));
  assert.equal(r.tokens.length, 39);
  assert.deepEqual(plain(r.symtab.map((s) => s.name)), ['main', 'rate', 'x1', 'printf']);
  assert.equal(r.symtab[2].uses, 6);
  const le = r.tokens.find((t) => t.lexeme === '<=');
  assert.equal(le.token + ',' + le.attr, 'relop,LE');
  assert.equal(r.tokens.filter((t) => t.cat === 'keyword').length, 4); // int, float, if, return
  assert.equal(r.tokens.find((t) => t.cat === 'string literal').lexeme, '"sum = %d\\n"');
  const bad = LX.lexC('x = 1 @ 2;');
  assert.equal(bad.tokens.filter((t) => t.token === 'error').length, 1);
});

test('input buffering: lexemes read back through the two halves', () => {
  for (const N of [4, 8, 16, 64]) {
    const b = LX.buffering(C_CODE, N);
    for (const f of b.frames) if (!f.lost) assert.equal(f.fromBuffer, f.lexeme, `N=${N}`);
    const longest = Math.max(...LX.lexC(C_CODE).tokens.map((t) => t.lexeme.length));
    if (N >= longest) assert.equal(b.tooLong.length, 0, `N=${N}`);
  }
  assert.ok(LX.buffering(C_CODE, 4).tooLong.length > 0);
});

const L_SPEC = '%{\n#include "y.tab.h"\n%}\ndigit   [0-9]\nletter  [a-zA-Z]\n%%\n[ \\t\\n]+  ;\n"if"   { return IF; }\n{letter}({letter}|{digit})*  { return ID; }\n{digit}+  { yylval = atoi(yytext); return NUM; }\n"+"|"-"|"*"|"/"|"("|")"  { return yytext[0]; }\n.  { printf("?"); }\n%%\nint yywrap(void) { return 1; }';
const Y_SPEC = "%token NUM\n%left '+' '-'\n%left '*' '/'\n%%\nexpr : expr '+' expr { $$ = $1 + $3; }\n     | expr '-' expr\n     | expr '*' expr\n     | expr '/' expr\n     | '(' expr ')' { $$ = $2; }\n     | NUM\n     ;\n%%";
test('Lex and Yacc files run end to end', () => {
  const spec = LX.parseLex(L_SPEC);
  const out = LX.runLex(spec, 'if ifx 42 + y');
  assert.deepEqual(plain(out.filter((t) => t.token).map((t) => `${t.lexeme}:${t.token}`)), ['if:IF', 'ifx:ID', '42:NUM', "+:'+'", 'y:ID']);
  const y = LX.parseYacc(Y_SPEC);
  const t = LX.yaccTable(y);
  assert.equal(t.raw.conflicts.length, 16);
  assert.equal(t.table.conflicts.length, 0);
  const P = ctx.DT.parsing;
  const good = LX.lexToYacc(y, LX.runLex(spec, '2 + 3 * ( 4 - 1 )'));
  assert.ok(P.lrParse(t.GA, t.table, good.toks).accepted);
  assert.ok(!P.lrParse(t.GA, t.table, LX.lexToYacc(y, LX.runLex(spec, '2 + * 3')).toks).accepted);
  // with precedence, 2 + 3 * 4 reduces * first: the handle 3 * 4 appears before 2 + E
  const trace = P.lrParse(t.GA, t.table, LX.lexToYacc(y, LX.runLex(spec, '2 + 3 * 4')).toks).rows.filter((r) => r.handle).map((r) => r.handle);
  assert.ok(trace.indexOf('Expr * Expr') < trace.indexOf('Expr + Expr'));
});

// ---------- phases of a compiler, %prec, trailing context ----------
test('compiler phases reproduce Aho figure 1.7', () => {
  const PH = ctx.DT.phases;
  const r = PH.run('position = initial + rate * 60');
  assert.equal(r.tokens.map((t) => (t.token === 'id' ? `<id,${t.attr}>` : `<${t.lexeme}>`)).join(' '), '<id,1> <=> <id,2> <+> <id,3> <*> <60>');
  assert.deepEqual(plain(r.tac.map(PH.tacStr)), ['t1 = inttofloat(60)', 't2 = id3 * t1', 't3 = id2 + t2', 'id1 = t3']);
  assert.deepEqual(plain(r.opt.code.map(PH.tacStr)), ['t1 = id3 * 60.0', 'id1 = id2 + t1']);
  assert.deepEqual(plain(r.prog.map((m) => m.op)), ['LDF', 'MULF', 'LDF', 'ADDF', 'STF']);
  assert.ok(r.check.ok);
  for (const src of ['int i, n\nfloat avg, sum\navg = sum / n\ni = i + 1', 'x = -(a + 2 * 3) * b', 'int k\nk = 2.5 * 4', 'y = (a + b) * (c - 1)\nz = y / 2']) {
    assert.ok(PH.run(src).check.ok, src);
  }
  assert.equal(PH.run('int k\nk = 2.5 * 4').opt.code.map(PH.tacStr).join(), 'id1 = 10');
  assert.throws(() => PH.run('x = a +'), /Syntax error/);
  assert.throws(() => PH.run('x = a @ b'), /Lexical error/);
});

test('yacc %prec makes unary minus bind tighter than *', () => {
  const LX = ctx.DT.lex, P = ctx.DT.parsing;
  const ys = "%token NUM\n%left '+' '-'\n%left '*' '/'\n%right UMINUS\n%%\ne : e '+' e | e '-' e | e '*' e | e '/' e | '-' e %prec UMINUS | NUM ;\n%%";
  const handles = (text) => { const y = LX.parseYacc(text), t = LX.yaccTable(y); assert.equal(t.table.conflicts.length, 0); return P.lrParse(t.GA, t.table, ['-', 'num', '*', 'num']).rows.filter((r) => r.handle).map((r) => r.handle); };
  const withPrec = handles(ys), without = handles(ys.replace(' %prec UMINUS', ''));
  assert.ok(withPrec.indexOf('- E') < withPrec.indexOf('E * E'), '(-2) * 3');
  assert.ok(without.indexOf('E * E') < without.indexOf('- E'), '-(2 * 3)');
});

test('lex trailing context r/s (Aho: DO5I=1,25 vs DO5I=1.25)', () => {
  const LX = ctx.DT.lex;
  const spec = LX.parseLex('%%\nDO/[A-Z0-9]*=[A-Z0-9]*,  { return DO; }\n[A-Z][A-Z0-9]*  { return ID; }\n[0-9.]+  { return NUM; }\n[=,]  { return yytext[0]; }\n%%');
  const run = (w) => LX.runLex(spec, w).map((t) => `${t.lexeme}:${t.token}`).join(' ');
  assert.equal(run('DO5I=1,25'), "DO:DO 5:NUM I:ID =:'=' 1:NUM ,:',' 25:NUM");
  assert.equal(run('DO5I=1.25'), "DO5I:ID =:'=' 1.25:NUM");
});

// Converter pages are generated from index.html; they must not drift from it.
test('converter pages and sitemap are up to date (run node scripts/build-pages.js)', () => {
  const { build, PAGES } = require('../scripts/build-pages.js');
  for (const [f, want] of Object.entries(build())) {
    assert.equal(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), want, `${f} is stale`);
  }
  for (const p of PAGES) {
    const h = fs.readFileSync(path.join(__dirname, '..', p.slug, 'index.html'), 'utf8');
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, `${p.slug}: exactly one h1`);
    assert.ok(h.includes(`<link rel="canonical" href="https://drawtomata.vercel.app/${p.slug}/">`));
    assert.ok(!/(src|href)="(js|css|assets)\//.test(h), `${p.slug}: asset paths must be relative to the parent folder`);
  }
});

// Security headers: every inline <script> must be allowed by a hash inside script-src,
// and every external script must carry an SRI digest that matches the file it loads.
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const csp = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
  .headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
const scriptSrc = (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === 'script-src') || []).slice(1);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([, attrs, body]) => ({ attrs, body }));
test('CSP script-src allows every inline script by hash', () => {
  assert.ok(scriptSrc.length, 'no script-src directive in CSP');
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src must not use 'unsafe-inline'");
  for (const { attrs, body } of scripts.filter((x) => !/\bsrc\s*=/i.test(x.attrs) && !/type\s*=\s*"application\/ld\+json"/i.test(x.attrs))) {
    const h = `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`;
    assert.ok(scriptSrc.includes(h), `inline <script${attrs}> changed: put ${h} in vercel.json script-src`);
  }
});
const external = scripts.map((x) => x.attrs).filter((a) => /\bsrc\s*=\s*"https?:/i.test(a))
  .map((a) => ({ src: a.match(/src\s*=\s*"([^"]+)"/i)[1], integrity: (a.match(/integrity\s*=\s*"([^"]+)"/i) || [])[1], cors: /crossorigin/i.test(a) }));
test('CDN scripts declare SRI and CORS', () => {
  for (const e of external) {
    assert.match(e.integrity || '', /^sha384-[A-Za-z0-9+/]+=*$/, `missing SRI on ${e.src}`);
    assert.ok(e.cors, `missing crossorigin on ${e.src}`);
    assert.ok(scriptSrc.some((s) => e.src.startsWith(s)), `${e.src} is not allowed by script-src`);
  }
});

// vendored libraries are served by the site itself; their SRI pins the exact bytes
test('vendored scripts match their SRI hash', () => {
  const local = scripts.map((x) => x.attrs).filter((a) => /\bsrc\s*=\s*"js\/vendor\//i.test(a));
  assert.ok(local.length, 'expected vendored scripts in index.html');
  for (const a of local) {
    const src = a.match(/src\s*=\s*"([^"]+)"/i)[1];
    const want = (a.match(/integrity\s*=\s*"([^"]+)"/i) || [])[1];
    if (!want) continue;
    const got = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(root, src))).digest('base64');
    assert.equal(want, got, `${src} does not match its integrity hash`);
  }
});

async function checkSriDigests() {
  for (const e of external) {
    let buf;
    try {
      const res = await fetch(e.src, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (process.env.CI) { failures.push(`SRI digest for ${e.src}\n    could not download: ${err.message}`); continue; }
      console.log(`(skipped SRI digest check for ${e.src}: offline)`);
      continue;
    }
    const got = 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
    try { assert.equal(e.integrity, got, `SRI for ${e.src} is stale: use ${got}`); passed++; } catch (err) { failures.push(`SRI digest for ${e.src}\n    ${err.message}`); }
  }
}

checkSriDigests().then(() => {
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
});
