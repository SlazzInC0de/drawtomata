// Run with: node tests/run.js  (or npm test)
// Loads the browser modules into one context and checks the conversions against each other.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ctx = vm.createContext({ console });
for (const f of ['regex.js', 'automata.js', 'grammar.js', 'parsing.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
}
const { regex, fa, grammar, parsing: P } = ctx.DT;

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

// Security headers: every inline <script> in index.html must be allowed by a hash in the CSP,
// and every external script must carry an SRI integrity attribute.
test('CSP covers inline scripts and CDN scripts use SRI', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const csp = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
    .headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
  for (const [, body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const h = require('crypto').createHash('sha256').update(body, 'utf8').digest('base64');
    assert.ok(csp.includes(`'sha256-${h}'`), `inline script changed: put 'sha256-${h}' in vercel.json script-src`);
  }
  for (const [tag] of html.matchAll(/<script[^>]+src="https?:[^>]*>/g)) assert.match(tag, /integrity="sha384-/, `missing SRI: ${tag}`);
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
