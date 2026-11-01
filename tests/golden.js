// Golden snapshots: the full output of every engine on fixed inputs, saved in tests/golden/*.json.
// tests/run.js fails if any output changes. When a change is intended, review the diff and run:
//   node tests/golden.js --update
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'golden');
const FILES = ['core.js', 'regex.js', 'automata.js', 'grammar.js', 'parsing.js', 'theory.js', 'codegen.js', 'sdt.js', 'lex.js', 'phases.js', 'learn.js'];

// a fresh context with a seeded Math.random, so the random checks are repeatable
function engines() {
  const ctx = vm.createContext({ console });
  vm.runInContext(`(() => { let s = 0x2f6b1a3d; Math.random = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`, ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  return ctx.DT;
}

// plain JSON with Sets, Maps and cycles made explicit; functions are dropped
function snap(x, seen = new WeakSet()) {
  if (x === undefined) return null;
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : (Number.isNaN(x) ? 'NaN' : x);
  if (seen.has(x)) return '[cycle]';
  seen.add(x);
  let out;
  if (x instanceof Set) out = { $set: [...x].map((v) => snap(v, seen)) };
  else if (x instanceof Map) out = { $map: [...x].map(([k, v]) => [snap(k, seen), snap(v, seen)]) };
  else if (Array.isArray(x)) out = x.map((v) => { const s = snap(v, seen); return s === undefined ? null : s; });
  else { out = {}; for (const k of Object.keys(x)) { const s = snap(x[k], seen); if (s !== undefined) out[k] = s; } }
  seen.delete(x);
  return out;
}
// long traces (a non-LL(1) grammar can loop until the step limit): keep the start and the count
const head = (r, n = 40) => ({ ...r, total: (r.rows || r.steps).length, rows: r.rows && r.rows.slice(0, n), steps: r.steps && r.steps.slice(0, n) });
const attempt = (f) => { try { return snap(f()); } catch (e) { return { error: e.message }; } };

const REs = ['(a+b)*abb', '(0+1)*01', 'a*b*', '(ab+ba)*', 'a(a+b)*b', 'λ', '∅', '(a+λ)(b+λ)', '((aab)*ab)*', 'a*+b*', '(a*b*)*', 'ab*(c+λ)', '(a+b)*a(a+b)', '(1+01)*(0+λ)'];
const CFGs = ['S -> aSb | λ', 'S -> SS | (S) | λ', 'E -> E+E | E*E | a', 'S -> aA | bB\nA -> a | aS\nB -> b | bS', 'S -> AB\nA -> aA | a\nB -> bB | λ', 'S -> aSa | bSb | a | b | λ'];
const RGs = ['S -> aA | b\nA -> bS | a', 'S -> 0S | 1A\nA -> 0A | 1S | λ', 'S -> Ab | b\nA -> Aa | a', 'S -> B1 | 0\nB -> B0 | 1'];
const PSs = [
  'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id',
  "E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id",
  'S -> C C\nC -> c C | d',
  'S -> L = R | R\nL -> * R | id\nR -> L',
  "S -> i E t S S' | a\nS' -> e S | ε\nE -> b",
  'S -> A a | b\nA -> A c | S d | ε',
  'E -> E + E | E * E | ( E ) | id',
  'S -> a A d | b B d | a B e | b A e\nA -> c\nB -> c',
  'A -> a A b | a b | ε'
];
const PS_INPUT = ['id + id * id', 'id * id + id', 'c d d', 'id = * id', 'i b t a e a', 'b d a', 'id + id * id', 'a c d', 'a a b b'];
const PDAs = ['δ(q0, a, z) = {(q0, az)}\nδ(q0, a, a) = {(q0, aa)}\nδ(q0, b, a) = {(q1, λ)}\nδ(q1, b, a) = {(q1, λ)}\nδ(q1, λ, z) = {(q2, z)}'];
const CG_PROGRAMS = [
  'a = b * -c + b * -c',
  'x = (a + b) * (a + b) - c / (a + b)',
  'a = b + c\nb = a - d\nc = b + c\nd = a - d',
  'x = a[i] + a[j]\nif x > 0 goto L1\ny = 0 - x\ngoto L2\nL1: y = x\nL2: z = y * 2',
  '1) i = 1\n2) j = 1\n3) t1 = 10 * i\n4) t2 = t1 + j\n5) t3 = 8 * t2\n6) t4 = t3 - 88\n7) a[t4] = 0\n8) j = j + 1\n9) if j <= 10 goto (3)\n10) i = i + 1\n11) if i <= 10 goto (2)\n12) i = 1\n13) t5 = i - 1\n14) t6 = 88 * t5\n15) a[t6] = 1\n16) i = i + 1\n17) if i <= 10 goto (13)',
  'if debug == 1 goto L1\ngoto L2\nL1: x = x * 1\ny = y * 2\nL2: i = i + 1\ngoto L3\nk = 0\nL3: goto L4\nL4: n = 4 * 2'
];
const SDDs = [
  ['L -> E n { L.val = E.val }\nE -> E1 + T { E.val = E1.val + T.val }\nE -> T { E.val = T.val }\nT -> T1 * F { T.val = T1.val * F.val }\nT -> F { T.val = F.val }\nF -> ( E ) { F.val = E.val }\nF -> digit { F.val = digit.lexval }', '3 * 5 + 4 n'],
  ["T -> F T' { T'.inh = F.val ; T.val = T'.syn }\nT' -> * F T1' { T1'.inh = T'.inh * F.val ; T'.syn = T1'.syn }\nT' -> ε { T'.syn = T'.inh }\nF -> digit { F.val = digit.lexval }", '3 * 5'],
  ['D -> T L { L.inh = T.type }\nT -> int { T.type = integer }\nT -> float { T.type = float }\nL -> L1 , id { L1.inh = L.inh ; addType(id.entry, L.inh) }\nL -> id { addType(id.entry, L.inh) }', 'float a , b , c'],
  ["E -> E1 + T { E.node = new Node('+', E1.node, T.node) }\nE -> E1 - T { E.node = new Node('-', E1.node, T.node) }\nE -> T { E.node = T.node }\nT -> ( E ) { T.node = E.node }\nT -> id { T.node = new Leaf(id, id.entry) }\nT -> num { T.node = new Leaf(num, num.val) }", 'a - 4 + c'],
  ["E -> E1 + T { E.t = E1.t || T.t || '+' }\nE -> E1 - T { E.t = E1.t || T.t || '-' }\nE -> T { E.t = T.t }\nT -> digit { T.t = digit.lexval }", '9 - 5 + 2']
];
const C_CODE = '#include <stdio.h>\nint main() {\n  float rate = 3.14E+2, x1; /* c */\n  if (x1 <= rate && x1 != 0) x1 = x1 + 1; // bump\n  printf("sum = %d\\n", x1);\n  return 0;\n}';
const LEX_SPEC = '%{\n#include "y.tab.h"\n%}\ndigit [0-9]\n%%\n{digit}+  { yylval = atoi(yytext); return NUM; }\n[-+*/()]  { return yytext[0]; }\n[ \\t]     ;\n%%';
const YACC_SPEC = "%token NUM\n%left '+' '-'\n%left '*' '/'\n%right UMINUS\n%%\nexpr : expr '+' expr | expr '-' expr | expr '*' expr | expr '/' expr | '(' expr ')' | '-' expr %prec UMINUS | NUM ;\n%%";

function collect() {
  const DT = engines();
  const { regex: RX, fa: FA, grammar: GR, parsing: P, theory: TH, codegen: CG, sdt: SD, lex: LX, phases: PH, learn: LN } = DT;
  const out = {};

  out.automata = REs.map((re) => attempt(() => {
    const ast = RX.parse(re), t = FA.thompson(ast), ef = FA.removeEps(t.fa), sb = FA.subset(t.fa), mn = FA.minimize(sb.fa);
    return {
      re, ast: RX.astStr(ast), thompson: t, removeEps: ef, subset: sb, minimize: mn,
      toRegex: attempt(() => FA.toRegex(mn.min)), right: attempt(() => FA.toRightLinear(mn.min)), left: attempt(() => FA.toLeftLinear(mn.min)),
      learnSubset: LN.subsetSteps(t.fa, sb), learnMin: mn.dfa.n > 1 ? LN.minimizeSteps(mn) : null
    };
  }));
  out.language = [
    [{ type: 'starts', w: 'ab' }, { type: 'countmod', x: 'b', m: 2, r: 0 }, 'and'], [{ type: 'ends', w: 'ba' }, { type: 'contains', w: 'aa' }, 'or'],
    [{ type: 'lenmod', m: 3, r: 1 }, null, null], [{ type: 'nthright', m: 3, x: 'a' }, null, null], [{ type: 'countcmp', x: 'a', op: '>=', m: 2 }, null, null]
  ].map(([c1, c2, op]) => attempt(() => {
    const A = ['a', 'b'], d1 = FA.buildCondition(c1, A);
    const fa = c2 ? FA.product(d1, FA.buildCondition(c2, A), op, A) : d1;
    return { c1, c2, op, fa, min: FA.minimize(fa).min };
  }));
  out.regularGrammars = RGs.map((g) => attempt(() => { const G = GR.parse(g); return { g, classify: GR.classify(G), nfa: GR.regularToNFA(G) }; }));
  out.cfg = CFGs.map((g) => attempt(() => {
    const G = GR.parse(g), pda = GR.cfgToPDA(G);
    return {
      g, classify: GR.classify(G), enumerate: GR.enumerate(G, 5), ambiguity: GR.findAmbiguity(G, 6),
      derive: attempt(() => GR.derive(G, GR.enumerate(G, 4).list.slice(-1)[0] || '', 2)), gnf: GR.isGNF(G),
      pda, pdaText: attempt(() => GR.pdaText(pda.trans)), pdaToCfg: attempt(() => TH.pdaToCfg(pda, 'empty'))
    };
  }));
  out.pda = PDAs.map((t) => attempt(() => { const pda = { start: 'q0', z: 'z', finals: ['q2'], trans: GR.parsePDA(t) }; return { pda, aabb: GR.simulatePDA(pda, 'aabb', 'final'), aab: GR.simulatePDA(pda, 'aab', 'final'), toCfg: attempt(() => TH.pdaToCfg(pda, 'final')) }; }));
  out.pumping = { game: Object.keys(TH.LANGUAGES).map((k) => [k, attempt(() => TH.pumpingGame(k, 3))]), regular: ['a*b', '(ab)*', 'a(a+b)*b'].map((re) => attempt(() => TH.pumpingRegular(re, re === '(ab)*' ? 'ababab' : re === 'a*b' ? 'aaaab' : 'aabab'))) };
  out.parsing = PSs.map((g, i) => attempt(() => {
    const G = P.parseGrammar(g), GA = P.augment(G), ff = P.firstFollow(GA), t = P.ll1(G);
    const c0 = P.lr0Collection(GA), c1 = P.lr1Collection(GA, ff), la = P.lalrFromLr1(GA, c1);
    const tables = { slr: P.lrTable(GA, c0, 'slr', ff), clr: P.lrTable(GA, c1, 'clr'), lalr: P.lrTable(GA, la, 'lalr') };
    const toks = P.tokenizeInput(PS_INPUT[i], G);
    return {
      g, firstFollow: P.firstFollow(G), leftRecursive: P.leftRecursive(G), removeLR: attempt(() => P.removeLeftRecursion(G)), leftFactor: attempt(() => P.leftFactor(G)),
      ll1: t, predictive: head(P.predictiveParse(G, t, toks)), recursive: attempt(() => P.recursiveDescent(G, t.ff)),
      lr0: c0, lr1: c1, lalr: la, tables, slrParse: P.lrParse(GA, tables.slr, toks), lalrParse: P.lrParse(GA, tables.lalr, toks),
      cnf: attempt(() => TH.simplifyCNF(G)),
      learnLL: head(LN.llSteps(G, P.predictiveParse(G, t, toks))), learnLR: LN.lrSteps(GA, P.lrParse(GA, tables.lalr, toks))
    };
  }));
  out.precedence = attempt(() => {
    const G = P.parseGrammar('E -> E + E | E * E | ( E ) | id'), prec = P.parsePrecedence('%left +\n%left *');
    const GA = P.augment(G), ff = P.firstFollow(GA), table = P.lrTable(GA, P.lalrFromLr1(GA, P.lr1Collection(GA, ff)), 'lalr');
    return { resolved: P.resolveConflicts(GA, table, prec), disambiguate: P.disambiguate(G, prec), opPrec: attempt(() => P.operatorPrecedence(G, prec)) };
  });
  out.codegen = CG_PROGRAMS.map((src) => attempt(() => {
    const prog = CG.parseProgram(src), bb = CG.basicBlocks(prog.ins);
    return { src, prog, reps: CG.representations(prog), bb, dom: CG.dominators(bb), live: CG.liveness(bb, CG.exitLiveOf ? CG.exitLiveOf(prog, bb) : undefined), opt: CG.optimize(prog), ssa: CG.toSSA(prog), gen: CG.generate(prog, 2), peep: CG.peephole(prog) };
  }));
  out.sdt = SDDs.map(([sdd, w]) => attempt(() => { const r = SD.run(sdd, w); return { sdd, w, classify: SD.classify(SD.parseSDD(sdd)), r }; }));
  out.lex = {
    diagrams: [['relop', '<='], ['relop', '<>'], ['id', 'x12'], ['number', '12.5E-3'], ['ws', '  x']].map(([k, w]) => attempt(() => LX.runDiagram(k, w))),
    combine: attempt(() => { const pats = LX.parsePatterns('a  a\nabb  abb\nab+  a*bb*'); const c = LX.combine(pats); return { c, scan: LX.scanDFA(c, 'aabbbab') }; }),
    lexC: attempt(() => LX.lexC(C_CODE)),
    buffering: attempt(() => LX.buffering('int count = 100 ; float averages = 3.5 ;', 8)),
    lexYacc: attempt(() => { const spec = LX.parseLex(LEX_SPEC), y = LX.parseYacc(YACC_SPEC); const run = LX.runLex(spec, '- 2 * 3 + ( 4 - 1 )'); return { spec, y, table: LX.yaccTable(y), run, parsed: LX.lexToYacc(y, run) }; })
  };
  out.phases = ['position = initial + rate * 60', 'int i, n\nfloat avg, sum\navg = sum / n\ni = i + 1', 'x = -(a + 2 * 3) * b', 'int k\nk = 2.5 * 4'].map((s) => attempt(() => PH.run(s)));
  return out;
}

if (require.main === module) {
  const update = process.argv.includes('--update');
  const got = collect();
  fs.mkdirSync(DIR, { recursive: true });
  let changed = 0;
  for (const [k, v] of Object.entries(got)) {
    const file = path.join(DIR, k + '.json'), text = JSON.stringify(v, null, 1) + '\n';
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (old === text) continue;
    changed++;
    if (update) fs.writeFileSync(file, text);
    console.log(`${update ? 'updated' : 'differs'}: tests/golden/${k}.json`);
  }
  console.log(changed ? (update ? `${changed} snapshot file(s) written` : `${changed} snapshot file(s) differ; review, then run with --update`) : 'all snapshots match');
}
module.exports = { collect, DIR };
