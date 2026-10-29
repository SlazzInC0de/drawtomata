/* Textbook checks: worked examples from the course books, each run through the same engines the site uses.
   Used by the /verified/ page (in the browser) and by tests/run.js (in Node). */
(function (DT) {
  'use strict';
  const EPS = DT.EPS || 'λ';
  const ALSU = 'Aho, Lam, Sethi, Ullman, Compilers (2nd ed.)';
  const LINZ = 'Linz, An Introduction to Formal Languages and Automata';
  const set = (s) => '{' + [...s].sort().join(', ') + '}';
  const EXPR_LL = "E -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id";
  const EXPR_LR = 'E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id';
  const lr = (text) => {
    const P = DT.parsing, G = P.parseGrammar(text), GA = P.augment(G), ff = P.firstFollow(GA);
    const c0 = P.lr0Collection(GA), c1 = P.lr1Collection(GA, ff), la = P.lalrFromLr1(GA, c1);
    return { G, GA, c0, c1, la, slr: P.lrTable(GA, c0, 'slr', ff), lalr: P.lrTable(GA, la, 'lalr') };
  };
  const subsetOf = (re) => { const t = DT.fa.thompson(DT.regex.parse(re)).fa; return DT.fa.subset(t); };

  const cases = [
    {
      id: 'subset', area: 'Automata', source: `${ALSU}, Example 3.21, Fig. 3.35`,
      what: 'Subset construction on the NFA for (a|b)*abb',
      input: '(a+b)*abb',
      expected: '5 DFA states (A to E), final state E',
      run: () => { const d = subsetOf('(a+b)*abb').fa; return `${d.n} DFA states (${d.labels[0]} to ${d.labels[d.n - 1]}), final state ${[...d.finals].map((q) => d.labels[q]).join(', ')}`; }
    },
    {
      id: 'minimize', area: 'Automata', source: `${ALSU}, Example 3.40`,
      what: 'Minimizing the DFA of Fig. 3.36',
      input: 'the 5-state DFA above',
      expected: '4 states: A and C are merged',
      run: () => { const m = DT.fa.minimize(subsetOf('(a+b)*abb').fa); const g = m.groups.filter((x) => x.length > 1).map((x) => x.map((q) => m.labels[q]).join(' and ')); return `${m.min.n} states: ${g.join('; ')} are merged`; }
    },
    {
      id: 'anbn', area: 'Automata', source: `${LINZ}, Ch. 4 (pumping lemma)`,
      what: 'aⁿbⁿ is not regular: w = aᵖbᵖ defeats every split',
      input: 'p = 1 to 6',
      expected: 'no split survives for any p',
      run: () => { let left = 0; for (let p = 1; p <= 6; p++) left += DT.theory.pumpingGame('anbn', p).pumpable.length; return left ? `${left} split(s) survive` : 'no split survives for any p'; }
    },
    {
      id: 'firstfollow', area: 'Parsing', source: `${ALSU}, Example 4.30`,
      what: 'FIRST and FOLLOW of the expression grammar',
      input: EXPR_LL,
      expected: 'FIRST(E) = {(, id}; FOLLOW(E) = {$, )}; FOLLOW(T) = {$, ), +}; FOLLOW(F) = {$, ), *, +}',
      run: () => { const P = DT.parsing, ff = P.firstFollow(P.parseGrammar(EXPR_LL)); return `FIRST(E) = ${set(ff.FIRST.get('E'))}; FOLLOW(E) = ${set(ff.FOLLOW.get('E'))}; FOLLOW(T) = ${set(ff.FOLLOW.get('T'))}; FOLLOW(F) = ${set(ff.FOLLOW.get('F'))}`; }
    },
    {
      id: 'll1', area: 'Parsing', source: `${ALSU}, Example 4.32, Fig. 4.17`,
      what: 'LL(1) parsing table of the expression grammar',
      input: EXPR_LL,
      expected: `LL(1), 13 entries, M[E', )] = E' → ${EPS}`,
      run: () => {
        const P = DT.parsing, G = P.parseGrammar(EXPR_LL), t = P.ll1(G);
        let n = 0; for (const row of t.M.values()) for (const c of row.values()) if (c.length) n++;
        return `${t.isLL1 ? 'LL(1)' : 'not LL(1)'}, ${n} entries, M[E', )] = ${P.prodStr(G.prods[t.M.get("E'").get(')')[0]])}`;
      }
    },
    {
      id: 'predictive', area: 'Parsing', source: `${ALSU}, Fig. 4.21`,
      what: 'Predictive parser output on id + id * id',
      input: 'id + id * id',
      expected: `E → T E'; T → F T'; F → id; T' → ${EPS}; E' → + T E'; T → F T'; F → id; T' → * F T'; F → id; T' → ${EPS}; E' → ${EPS}; accept`,
      run: () => { const P = DT.parsing, G = P.parseGrammar(EXPR_LL), r = P.predictiveParse(G, P.ll1(G), ['id', '+', 'id', '*', 'id']); return r.rows.filter((x) => !x.action.startsWith('match')).map((x) => x.action.replace(/^output /, '')).join('; '); }
    },
    {
      id: 'lr0', area: 'Parsing', source: `${ALSU}, Fig. 4.31 and Fig. 4.37`,
      what: 'LR(0) items and SLR table of the expression grammar',
      input: EXPR_LR,
      expected: '12 item sets (I0 to I11), SLR table has no conflicts',
      run: () => { const e = lr(EXPR_LR); return `${e.c0.states.length} item sets (I0 to I${e.c0.states.length - 1}), SLR table has ${e.slr.conflicts.length ? e.slr.conflicts.length + ' conflict(s)' : 'no conflicts'}`; }
    },
    {
      id: 'slrparse', area: 'Parsing', source: `${ALSU}, Fig. 4.38`,
      what: 'Moves of the SLR parser on id * id + id',
      input: 'id * id + id',
      expected: 's5, r F → id, r T → F, s7, s5, r F → id, r T → T * F, r E → T, s6, s5, r F → id, r T → F, r E → E + T, accept',
      run: () => { const e = lr(EXPR_LR), r = DT.parsing.lrParse(e.GA, e.slr, ['id', '*', 'id', '+', 'id']); return r.rows.map((x) => x.action.replace(/^shift /, 's').replace(/^reduce by /, 'r ').replace(/\s*([*+])\s*/g, ' $1 ')).join(', '); }
    },
    {
      id: 'slrconflict', area: 'Parsing', source: `${ALSU}, Example 4.48`,
      what: 'S → L = R | R is not SLR, but it is LALR',
      input: 'S -> L = R | R\nL -> * R | id\nR -> L',
      expected: 'SLR: 1 conflict, on =; LALR: no conflicts',
      run: () => { const e = lr('S -> L = R | R\nL -> * R | id\nR -> L'); return `SLR: ${e.slr.conflicts.length} conflict, on ${e.slr.conflicts.map((c) => c.a).join(', ')}; LALR: ${e.lalr.conflicts.length ? e.lalr.conflicts.length + ' conflicts' : 'no conflicts'}`; }
    },
    {
      id: 'lalr', area: 'Parsing', source: `${ALSU}, Examples 4.54 and 4.58`,
      what: 'LR(1) and LALR states of S → C C, C → c C | d',
      input: 'S -> C C\nC -> c C | d',
      expected: '10 LR(1) states, 7 LALR states',
      run: () => { const e = lr('S -> C C\nC -> c C | d'); return `${e.c1.states.length} LR(1) states, ${e.la.states.length} LALR states`; }
    },
    {
      id: 'annotated', area: 'Compiler', source: `${ALSU}, Example 5.2, Fig. 5.3`,
      what: 'Annotated parse tree for 3 * 5 + 4 n',
      input: '3 * 5 + 4 n',
      expected: 'L.val = 19',
      run: () => {
        const sdd = 'L -> E n { L.val = E.val }\nE -> E1 + T { E.val = E1.val + T.val }\nE -> T { E.val = T.val }\nT -> T1 * F { T.val = T1.val * F.val }\nT -> F { T.val = F.val }\nF -> ( E ) { F.val = E.val }\nF -> digit { F.val = digit.lexval }';
        const r = DT.sdt.run(sdd, '3 * 5 + 4 n');
        const I = [...r.res.inst.values()].find((x) => x.node === r.root && x.attr === 'val');
        return `L.val = ${r.res.show(I.value)}`;
      }
    },
    {
      id: 'syntaxtree', area: 'Compiler', source: `${ALSU}, Example 5.11, Fig. 5.11`,
      what: 'Syntax tree for a - 4 + c built by semantic rules',
      input: 'a - 4 + c',
      expected: 'p1 = Leaf(id, a); p2 = Leaf(num, 4); p3 = Node(-, p1, p2); p4 = Leaf(id, c); p5 = Node(+, p3, p4)',
      run: () => {
        const sdd = "E -> E1 + T { E.node = new Node('+', E1.node, T.node) }\nE -> E1 - T { E.node = new Node('-', E1.node, T.node) }\nE -> T { E.node = T.node }\nT -> ( E ) { T.node = E.node }\nT -> id { T.node = new Leaf(id, id.entry) }\nT -> num { T.node = new Leaf(num, num.val) }";
        return DT.sdt.run(sdd, 'a - 4 + c').res.tree.map((n, i) => `p${i + 1} = ${n.call}`).join('; ');
      }
    },
    {
      id: 'phases', area: 'Compiler', source: `${ALSU}, Fig. 1.7`,
      what: 'Phases of a compiler on position = initial + rate * 60',
      input: 'position = initial + rate * 60',
      expected: 'tokens <id,1> <=> <id,2> <+> <id,3> <*> <60>; optimized: t1 = id3 * 60.0 ; id1 = id2 + t1',
      run: () => { const PH = DT.phases, r = PH.run('position = initial + rate * 60'); return `tokens ${r.tokens.map((t) => (t.token === 'id' ? `<id,${t.attr}>` : `<${t.lexeme}>`)).join(' ')}; optimized: ${r.opt.code.map(PH.tacStr).join(' ; ')}`; }
    },
    {
      id: 'tac', area: 'Compiler', source: `${ALSU}, Section 6.2, Fig. 6.10`,
      what: 'Three-address code for a = b * - c + b * - c',
      input: 'a = b * -c + b * -c',
      expected: 't1 = minus c ; t2 = b * t1 ; t3 = minus c ; t4 = b * t3 ; t5 = t2 + t4 ; a = t5',
      run: () => { const CG = DT.codegen; return CG.parseProgram('a = b * -c + b * -c').ins.map((x) => CG.insStr(x)).join(' ; '); }
    },
    {
      id: 'leaders', area: 'Compiler', source: `${ALSU}, Example 8.5`,
      what: 'Leaders of the code that sets a 10×10 matrix to the identity',
      input: '17 three-address instructions',
      expected: 'leaders 1, 2, 3, 10, 12, 13 (6 basic blocks)',
      run: () => {
        const code = '1) i = 1\n2) j = 1\n3) t1 = 10 * i\n4) t2 = t1 + j\n5) t3 = 8 * t2\n6) t4 = t3 - 88\n7) a[t4] = 0\n8) j = j + 1\n9) if j <= 10 goto (3)\n10) i = i + 1\n11) if i <= 10 goto (2)\n12) i = 1\n13) t5 = i - 1\n14) t6 = 88 * t5\n15) a[t6] = 1\n16) i = i + 1\n17) if i <= 10 goto (13)';
        const bb = DT.codegen.basicBlocks(DT.codegen.parseProgram(code).ins);
        return `leaders ${bb.leaders.map((i) => i + 1).join(', ')} (${bb.blocks.length} basic blocks)`;
      }
    }
  ];

  const runAll = () => cases.map((c) => {
    let actual;
    try { actual = c.run(); } catch (e) { actual = 'error: ' + e.message; }
    return { ...c, actual, ok: actual === c.expected };
  });
  DT.textbook = { cases, runAll };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
