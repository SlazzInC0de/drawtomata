// Syntax analysis (Aho, Lam, Sethi, Ullman ch. 4): grammar transformations,
// FIRST/FOLLOW, LL(1), recursive descent, LR(0)/SLR/CLR/LALR, precedence, operator precedence.
//
// Grammar shape: { start, nts: [names in order], terms: [names], prods: [{ lhs, rhs: [symbols] }] }
// rhs [] is an ε-production. '$' is the end marker and cannot be a grammar terminal.
(function (DT) {
  'use strict';
  const END = '$';
  const EPS = DT.EPS;

  // ---------- reading grammars ----------
  const KEYWORDS = new Set(['id', 'num', 'if', 'then', 'else', 'while', 'do', 'for', 'int', 'float', 'real', 'char', 'bool',
    'true', 'false', 'not', 'and', 'or', 'begin', 'end', 'print', 'return', 'digit', 'letter', 'var', 'const', 'void', 'main', 'call', 'num1', 'id1', 'id2', 'str']);
  const EPS_WORDS = new Set(['ε', 'λ', 'Λ', '∈', '@', 'eps', 'epsilon', 'lambda']);

  // Splits one alternative into symbols. With spaces, each spaced word stays whole when it is
  // a word or a run of punctuation (so "id", ":=" and "==" survive); without spaces, uppercase
  // letters plus digits/primes are nonterminals and lowercase runs split into keywords or letters.
  function tokenizeAlt(text) {
    const s = text.trim();
    if (!s || EPS_WORDS.has(s)) return [];
    const spaced = /\s/.test(s);
    const out = [];
    const scan = (chunk) => {
      if (EPS_WORDS.has(chunk)) return;
      if (spaced && /^[^\sA-Za-z0-9'"]{2,}$/.test(chunk)) { out.push(chunk); return; }
      if (spaced && /^[a-z][a-z0-9_]*$/.test(chunk)) { out.push(chunk); return; }
      let i = 0;
      while (i < chunk.length) {
        const c = chunk[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "'" || c === '"') {
          const j = chunk.indexOf(c, i + 1);
          if (j > i + 1) { out.push(chunk.slice(i + 1, j)); i = j + 1; continue; }
        }
        if (/[A-Z]/.test(c)) {
          let j = i + 1;
          while (j < chunk.length && /[0-9'’′_]/.test(chunk[j])) j++;
          out.push(chunk.slice(i, j).replace(/[’′]/g, "'"));
          i = j; continue;
        }
        if (/[a-z]/.test(c)) {
          let j = i + 1;
          while (j < chunk.length && /[a-z0-9_]/.test(chunk[j])) j++;
          let run = chunk.slice(i, j);
          while (run.length) {
            let k = run.length;
            while (k > 1 && !KEYWORDS.has(run.slice(0, k))) k--;
            out.push(run.slice(0, k));
            run = run.slice(k);
          }
          i = j; continue;
        }
        if (c === 'ε' || c === 'λ' || c === '∈') { i++; continue; }
        out.push(c); i++;
      }
    };
    if (spaced) s.split(/\s+/).forEach(scan); else scan(s);
    return out;
  }

  const isNT = (G, s) => G.ntSet.has(s);

  function parseGrammar(text) {
    const prods = [], order = [];
    let last = null;
    const lines = text.split(/\n|;/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('#'));
    if (!lines.length) throw new Error('Grammar is empty. Write productions like  E -> E + T | T');
    for (const line of lines) {
      let lhs, rhsText;
      const m = line.match(/^(.*?)(->|→|::=|=>|⟶|-->)(.*)$/);
      if (m) {
        lhs = m[1].trim().replace(/[’′]/g, "'");
        if (!/^[A-Z][A-Za-z0-9_']*$/.test(lhs)) throw new Error(`Left side "${m[1].trim()}" must be one nonterminal starting with a capital letter, like E or E'.`);
        rhsText = m[3];
      } else if (line.startsWith('|') && last) { lhs = last; rhsText = line.slice(1); }
      else throw new Error(`Cannot read "${line}". Use the form  A -> α | β`);
      last = lhs;
      if (!order.includes(lhs)) order.push(lhs);
      for (const alt of rhsText.split('|')) {
        const rhs = tokenizeAlt(alt);
        if (!prods.some((p) => p.lhs === lhs && p.rhs.join(' ') === rhs.join(' '))) prods.push({ lhs, rhs });
      }
    }
    return build(order[0], order, prods);
  }

  // Builds the derived fields. Symbols that look like nonterminals but have no productions are errors.
  function build(start, order, prods) {
    const ntSet = new Set(order);
    const terms = [];
    const undef = [];
    for (const p of prods) for (const s of p.rhs) {
      if (ntSet.has(s)) continue;
      if (/^[A-Z]/.test(s) && s.length <= 3 && /^[A-Z][0-9']*$/.test(s)) { if (!undef.includes(s)) undef.push(s); continue; }
      if (s === END) throw new Error('"$" is the end marker and cannot be used as a terminal.');
      if (!terms.includes(s)) terms.push(s);
    }
    // Nonterminals used without productions (common in slide exercises) are kept, with a warning.
    const nts = [...order, ...undef];
    const warnings = undef.length ? [`${undef.join(', ')} ${undef.length > 1 ? 'have' : 'has'} no productions, so ${undef.length > 1 ? 'they derive' : 'it derives'} no strings.`] : [];
    return { start, nts, ntSet: new Set(nts), terms, prods, warnings };
  }

  const seqStr = (seq) => (seq.length ? (seq.every((s) => s.length === 1) ? seq.join('') : seq.join(' ')) : EPS);
  const prodStr = (p) => `${p.lhs} → ${seqStr(p.rhs)}`;
  const setStr = (set, order) => {
    const arr = [...set];
    if (order) arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return '{ ' + arr.join(', ') + ' }';
  };
  function grammarText(G) {
    return G.nts.map((A) => {
      const alts = G.prods.filter((p) => p.lhs === A).map((p) => (p.rhs.length ? p.rhs.join(' ') : EPS));
      return `${A} -> ${alts.join(' | ')}`;
    }).join('\n');
  }
  function grouped(G) {
    return G.nts.map((A) => ({ lhs: A, rhs: G.prods.filter((p) => p.lhs === A).map((p) => seqStr(p.rhs)) })).filter((g) => g.rhs.length);
  }
  const freshName = (G, base) => { let n = base + "'"; while (G.ntSet.has(n) || G.terms.includes(n)) n += "'"; return n; };

  // ---------- FIRST and FOLLOW ----------
  function firstFollow(G) {
    const FIRST = new Map(G.nts.map((A) => [A, new Set()]));
    const symOrder = [...G.terms, EPS];
    const firstSeq = (seq) => {
      const out = new Set();
      for (const X of seq) {
        if (!isNT(G, X)) { out.add(X); return out; }
        for (const a of FIRST.get(X)) if (a !== EPS) out.add(a);
        if (!FIRST.get(X).has(EPS)) return out;
      }
      out.add(EPS);
      return out;
    };
    const firstPasses = [];
    for (let changed = true; changed;) {
      changed = false;
      for (const p of G.prods) {
        const S = FIRST.get(p.lhs), before = S.size;
        for (const a of firstSeq(p.rhs)) S.add(a);
        if (S.size !== before) changed = true;
      }
      firstPasses.push(new Map([...FIRST].map(([k, v]) => [k, new Set(v)])));
    }
    const FOLLOW = new Map(G.nts.map((A) => [A, new Set()]));
    FOLLOW.get(G.start).add(END);
    const followPasses = [new Map([...FOLLOW].map(([k, v]) => [k, new Set(v)]))];
    for (let changed = true; changed;) {
      changed = false;
      for (const p of G.prods) {
        p.rhs.forEach((B, i) => {
          if (!isNT(G, B)) return;
          const S = FOLLOW.get(B), before = S.size;
          const f = firstSeq(p.rhs.slice(i + 1));
          for (const a of f) if (a !== EPS) S.add(a);
          if (f.has(EPS)) for (const a of FOLLOW.get(p.lhs)) S.add(a);
          if (S.size !== before) changed = true;
        });
      }
      followPasses.push(new Map([...FOLLOW].map(([k, v]) => [k, new Set(v)])));
    }
    return { FIRST, FOLLOW, firstSeq, firstPasses, followPasses, symOrder, termOrder: [...G.terms, END] };
  }

  // ---------- left recursion ----------
  // Left-corner reachability, treating nullable prefixes as transparent.
  function leftCorners(G) {
    const nullable = new Set();
    for (let ch = true; ch;) {
      ch = false;
      for (const p of G.prods) if (!nullable.has(p.lhs) && p.rhs.every((s) => nullable.has(s))) { nullable.add(p.lhs); ch = true; }
    }
    const edge = new Map(G.nts.map((A) => [A, new Set()]));
    for (const p of G.prods) for (const s of p.rhs) { if (!isNT(G, s)) break; edge.get(p.lhs).add(s); if (!nullable.has(s)) break; }
    const reach = new Map();
    for (const A of G.nts) {
      const seen = new Set(), st = [...edge.get(A)];
      while (st.length) { const B = st.pop(); if (seen.has(B)) continue; seen.add(B); for (const C of edge.get(B)) st.push(C); }
      reach.set(A, seen);
    }
    return { reach, nullable };
  }
  function leftRecursive(G) {
    const { reach } = leftCorners(G);
    return G.nts.filter((A) => reach.get(A).has(A));
  }

  // Aho et al. Algorithm 4.19. Substitution Ai -> Aj γ is done only when Aj can lead back to Ai,
  // which removes every indirect cycle without rewriting productions that never needed it.
  function removeLeftRecursion(G) {
    const steps = [];
    let cur = { ...G, prods: G.prods.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] })), nts: [...G.nts], ntSet: new Set(G.nts) };
    const { nullable } = leftCorners(G);
    const warnings = [];
    if (G.prods.some((p) => p.rhs.length && isNT(G, p.rhs[0]) && nullable.has(p.rhs[0]) && p.rhs.length > 1)) {
      warnings.push('Some production starts with a nullable nonterminal. The standard algorithm assumes no ε-productions, so check the result.');
    }
    const order = [...G.nts];
    for (let i = 0; i < order.length; i++) {
      const Ai = order[i];
      for (let j = 0; j < i; j++) {
        const Aj = order[j];
        const { reach } = leftCorners(build(cur.start, cur.nts, cur.prods));
        if (!(reach.get(Aj) && (reach.get(Aj).has(Ai) || Aj === Ai))) continue;
        const targets = cur.prods.filter((p) => p.lhs === Ai && p.rhs[0] === Aj);
        if (!targets.length) continue;
        const ajAlts = cur.prods.filter((p) => p.lhs === Aj).map((p) => p.rhs);
        const next = [];
        for (const p of cur.prods) {
          if (p.lhs === Ai && p.rhs[0] === Aj) for (const d of ajAlts) next.push({ lhs: Ai, rhs: [...d, ...p.rhs.slice(1)] });
          else next.push(p);
        }
        cur.prods = dedupe(next);
        steps.push({ kind: 'substitute', text: `Replace ${targets.map(prodStr).join(', ')} by substituting the ${Aj}-productions, because ${Aj} can derive a string starting with ${Ai}.`, result: cur.prods.filter((p) => p.lhs === Ai).map(prodStr) });
      }
      const mine = cur.prods.filter((p) => p.lhs === Ai);
      const alphas = mine.filter((p) => p.rhs[0] === Ai).map((p) => p.rhs.slice(1));
      if (!alphas.length) continue;
      const betas = mine.filter((p) => p.rhs[0] !== Ai).map((p) => p.rhs);
      const tmp = build(cur.start, cur.nts, cur.prods);
      const A2 = freshName(tmp, Ai);
      const rest = cur.prods.filter((p) => p.lhs !== Ai);
      const newAi = (betas.length ? betas : [[]]).map((b) => ({ lhs: Ai, rhs: [...b, A2] }));
      const newA2 = [...alphas.filter((a) => a.length).map((a) => ({ lhs: A2, rhs: [...a, A2] })), { lhs: A2, rhs: [] }];
      const idx = cur.prods.findIndex((p) => p.lhs === Ai);
      cur.prods = [...rest.slice(0, idx), ...newAi, ...newA2, ...rest.slice(idx)];
      const pos = cur.nts.indexOf(Ai);
      cur.nts.splice(pos + 1, 0, A2);
      cur.ntSet = new Set(cur.nts);
      if (alphas.some((a) => !a.length)) warnings.push(`${Ai} → ${Ai} is a useless cycle and was dropped.`);
      steps.push({
        kind: 'immediate',
        text: `${Ai} is immediately left-recursive: ${Ai} → ${Ai}α with α ∈ {${alphas.map(seqStr).join(', ')}}, β ∈ {${betas.map(seqStr).join(', ') || EPS}}. Rewrite as ${Ai} → β${A2} and ${A2} → α${A2} | ${EPS}.`,
        result: [...newAi, ...newA2].map(prodStr)
      });
    }
    const out = build(cur.start, cur.nts, cur.prods);
    return { G: out, steps, changed: steps.length > 0, remaining: leftRecursive(out), warnings };
  }
  function dedupe(prods) {
    const seen = new Set();
    return prods.filter((p) => { const k = p.lhs + '→' + p.rhs.join(' '); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ---------- left factoring ----------
  function leftFactor(G) {
    const steps = [];
    let prods = G.prods.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] }));
    const nts = G.nts.filter((A) => G.prods.some((p) => p.lhs === A));
    for (let guard = 0; guard < 100; guard++) {
      let done = true;
      for (const A of [...nts]) {
        const alts = prods.filter((p) => p.lhs === A);
        const byFirst = new Map();
        for (const p of alts) if (p.rhs.length) { const k = p.rhs[0]; if (!byFirst.has(k)) byFirst.set(k, []); byFirst.get(k).push(p); }
        const group = [...byFirst.values()].find((g) => g.length > 1);
        if (!group) continue;
        let n = 1;
        while (group.every((p) => p.rhs.length > n && p.rhs[n] === group[0].rhs[n])) n++;
        const alpha = group[0].rhs.slice(0, n);
        const tmp = build(G.start, nts, prods);
        const A2 = freshName(tmp, A);
        const tails = group.map((p) => p.rhs.slice(n)).sort((x, y) => (x.length === 0) - (y.length === 0));
        const first = prods.indexOf(group[0]);
        const newA = { lhs: A, rhs: [...alpha, A2] };
        const newA2 = dedupe(tails.map((t) => ({ lhs: A2, rhs: t })));
        const before = prods.slice(0, first).filter((p) => !group.includes(p));
        const after = prods.slice(first).filter((p) => !group.includes(p));
        const lastA = after.reduce((k, p, i) => (p.lhs === A ? i : k), -1);
        prods = [...before, newA, ...after.slice(0, lastA + 1), ...newA2, ...after.slice(lastA + 1)];
        nts.splice(nts.indexOf(A) + 1, 0, A2);
        steps.push({ text: `${group.map(prodStr).join(', ')} share the prefix ${seqStr(alpha)}. Factor it out: ${A} → ${seqStr(alpha)}${A2} and ${A2} → ${tails.map(seqStr).join(' | ')}.`, result: [newA, ...newA2].map(prodStr) });
        done = false;
        break;
      }
      if (done) break;
    }
    return { G: build(G.start, nts, prods), steps, changed: steps.length > 0 };
  }

  // ---------- LL(1) ----------
  function ll1(G, ff = firstFollow(G)) {
    const cols = [...G.terms, END];
    const M = new Map(G.nts.map((A) => [A, new Map(cols.map((a) => [a, []]))]));
    const why = [];
    G.prods.forEach((p, i) => {
      const f = ff.firstSeq(p.rhs);
      for (const a of f) if (a !== EPS) M.get(p.lhs).get(a).push(i);
      if (f.has(EPS)) for (const b of ff.FOLLOW.get(p.lhs)) M.get(p.lhs).get(b).push(i);
      why.push({ p: i, first: f, usesFollow: f.has(EPS) });
    });
    const conflicts = [];
    for (const A of G.nts) for (const a of cols) { const c = M.get(A).get(a); if (c.length > 1) conflicts.push({ A, a, prods: [...c] }); }
    return { M, cols, conflicts, isLL1: conflicts.length === 0, why, ff };
  }

  function predictiveParse(G, table, tokens, limit = 2000) {
    const input = [...tokens, END];
    const stack = [END, G.start];
    const rows = [];
    let ip = 0, matched = [], ok = false, error = null;
    for (let step = 0; step < limit; step++) {
      const X = stack[stack.length - 1], a = input[ip];
      const row = { matched: matched.join(' '), stack: [...stack], input: input.slice(ip), action: '' };
      rows.push(row);
      if (X === END && a === END) { row.action = 'accept'; ok = true; break; }
      if (X === a) { stack.pop(); ip++; matched.push(a); row.action = `match ${a}`; continue; }
      if (!isNT(G, X)) { row.action = `error: expected ${X}`; error = row.action; break; }
      const cell = table.M.get(X).get(a) || [];
      if (!cell.length) { row.action = `error: M[${X}, ${a}] is empty`; error = row.action; break; }
      const p = G.prods[cell[0]];
      stack.pop();
      for (let k = p.rhs.length - 1; k >= 0; k--) stack.push(p.rhs[k]);
      row.action = `output ${prodStr(p)}` + (cell.length > 1 ? ' (conflict: first entry used)' : '');
    }
    if (!ok && !error) error = 'step limit reached';
    return { rows, accepted: ok, error };
  }

  // ---------- recursive descent ----------
  const fnName = (A) => A + '()';
  const lit = (a) => `'${a}'`;
  function recursiveDescent(G, ff = firstFollow(G)) {
    const lines = [];
    lines.push('void match(token t) {', '    if (lookahead == t) lookahead = nextToken();', '    else error();', '}', '');
    for (const A of G.nts) {
      const alts = G.prods.map((p, i) => ({ p, i })).filter((x) => x.p.lhs === A);
      lines.push(`void ${fnName(A)} {`);
      const body = (rhs, ind) => (rhs.length ? rhs.map((s) => ind + (isNT(G, s) ? `${fnName(s)};` : `match(${lit(s)});`)) : [ind + `/* ${EPS}: do nothing */`]);
      if (alts.length === 1 && alts[0].p.rhs.length) {
        lines.push(...body(alts[0].p.rhs, '    '));
      } else {
        const epsAlt = alts.find((x) => ff.firstSeq(x.p.rhs).has(EPS));
        const branches = alts.filter((x) => x !== epsAlt);
        branches.forEach((x, k) => {
          const f = [...ff.firstSeq(x.p.rhs)].filter((t) => t !== EPS);
          const cond = f.map((t) => `lookahead == ${lit(t)}`).join(' || ');
          lines.push(`    ${k ? 'else if' : 'if'} (${cond}) {`, ...body(x.p.rhs, '        '), '    }');
        });
        if (epsAlt) {
          if (branches.length) lines.push('    else {', ...body(epsAlt.p.rhs, '        '), '    }');
          else lines.push(...body(epsAlt.p.rhs, '    '));
        } else lines.push('    else error();');
      }
      lines.push('}', '');
    }
    return lines.join('\n');
  }
  // Simulates the procedures above. Choice of alternative uses the LL(1) table (same as the if-conditions).
  function recursiveTrace(G, table, tokens, limit = 3000) {
    const input = [...tokens, END];
    let ip = 0, steps = 0;
    const lines = [];
    let error = null;
    const call = (A, depth) => {
      if (error || ++steps > limit) { error = error || 'step limit reached'; return; }
      const a = input[ip];
      const cell = table.M.get(A).get(a) || [];
      lines.push({ depth, text: `${fnName(A)}`, note: `lookahead = ${a}` });
      if (!cell.length) { error = `${fnName(A)}: no alternative starts with ${a}`; lines.push({ depth: depth + 1, text: 'error()', bad: true }); return; }
      const p = G.prods[cell[0]];
      if (!p.rhs.length) { lines.push({ depth: depth + 1, text: `${EPS}: return`, note: '' }); return; }
      for (const s of p.rhs) {
        if (error) return;
        if (isNT(G, s)) call(s, depth + 1);
        else if (input[ip] === s) { lines.push({ depth: depth + 1, text: `match(${lit(s)})`, note: 'ok', ok: true }); ip++; }
        else { error = `expected ${s} but found ${input[ip]}`; lines.push({ depth: depth + 1, text: `match(${lit(s)})`, note: `found ${input[ip]}`, bad: true }); return; }
      }
    };
    call(G.start, 0);
    const accepted = !error && input[ip] === END;
    if (!error && !accepted) error = `input left over: ${input.slice(ip, -1).join(' ')}`;
    return { lines, accepted, error };
  }

  // ---------- LR items ----------
  function augment(G) {
    const S2 = freshName(G, G.start);
    const prods = [{ lhs: S2, rhs: [G.start] }, ...G.prods];
    const A = build(S2, [S2, ...G.nts], prods);
    A.orig = G;
    return A;
  }
  const itemStr = (G, it) => {
    const p = G.prods[it.p];
    const r = [...p.rhs];
    r.splice(it.dot, 0, '•');
    return `${p.lhs} → ${r.length === 1 ? '•' : r.join(' ')}`;
  };

  function lr0Collection(GA) {
    const key = (items) => items.map((i) => i.p + '.' + i.dot).sort().join('|');
    const closure = (kernel) => {
      const items = [...kernel], seen = new Set(items.map((i) => i.p + '.' + i.dot));
      for (let k = 0; k < items.length; k++) {
        const it = items[k], B = GA.prods[it.p].rhs[it.dot];
        if (!B || !isNT(GA, B)) continue;
        GA.prods.forEach((p, i) => { if (p.lhs === B && !seen.has(i + '.0')) { seen.add(i + '.0'); items.push({ p: i, dot: 0 }); } });
      }
      return items;
    };
    const states = [], trans = [], idx = new Map();
    const add = (kernel) => {
      const k = key(kernel);
      if (idx.has(k)) return idx.get(k);
      const items = closure(kernel);
      idx.set(k, states.length);
      states.push({ kernel: kernel.length, items });
      return states.length - 1;
    };
    add([{ p: 0, dot: 0 }]);
    for (let s = 0; s < states.length; s++) {
      const syms = [];
      for (const it of states[s].items) { const X = GA.prods[it.p].rhs[it.dot]; if (X && !syms.includes(X)) syms.push(X); }
      for (const X of syms) {
        const kernel = states[s].items.filter((it) => GA.prods[it.p].rhs[it.dot] === X).map((it) => ({ p: it.p, dot: it.dot + 1 }));
        trans.push({ from: s, sym: X, to: add(kernel) });
      }
    }
    return { states, trans };
  }

  function lr1Collection(GA, ff) {
    const firstSeqLa = (seq, la) => {
      const f = ff.firstSeq(seq);
      const out = new Set([...f].filter((a) => a !== EPS));
      if (f.has(EPS)) out.add(la);
      return out;
    };
    const ik = (i) => i.p + '.' + i.dot + '.' + i.la;
    const closure = (kernel) => {
      const items = [...kernel], seen = new Set(items.map(ik));
      for (let k = 0; k < items.length; k++) {
        const it = items[k], rhs = GA.prods[it.p].rhs, B = rhs[it.dot];
        if (!B || !isNT(GA, B)) continue;
        const las = firstSeqLa(rhs.slice(it.dot + 1), it.la);
        GA.prods.forEach((p, i) => {
          if (p.lhs !== B) return;
          for (const b of las) { const n = { p: i, dot: 0, la: b }; if (!seen.has(ik(n))) { seen.add(ik(n)); items.push(n); } }
        });
      }
      return items;
    };
    const states = [], trans = [], idx = new Map();
    const add = (kernel) => {
      const k = kernel.map(ik).sort().join('|');
      if (idx.has(k)) return idx.get(k);
      idx.set(k, states.length);
      states.push({ kernel: kernel.length, items: closure(kernel) });
      return states.length - 1;
    };
    add([{ p: 0, dot: 0, la: END }]);
    for (let s = 0; s < states.length; s++) {
      const syms = [];
      for (const it of states[s].items) { const X = GA.prods[it.p].rhs[it.dot]; if (X && !syms.includes(X)) syms.push(X); }
      for (const X of syms) {
        const kernel = states[s].items.filter((it) => GA.prods[it.p].rhs[it.dot] === X).map((it) => ({ p: it.p, dot: it.dot + 1, la: it.la }));
        trans.push({ from: s, sym: X, to: add(kernel) });
      }
    }
    return { states, trans };
  }

  // Merge LR(1) states with the same core.
  function lalrFromLr1(GA, c1) {
    const coreKey = (st) => [...new Set(st.items.map((i) => i.p + '.' + i.dot))].sort().join('|');
    const groups = new Map(), map = [];
    c1.states.forEach((st, i) => {
      const k = coreKey(st);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    const order = [...groups.values()].sort((a, b) => a[0] - b[0]);
    order.forEach((g, n) => g.forEach((i) => (map[i] = n)));
    const states = order.map((g) => {
      const seen = new Set(), items = [];
      for (const i of g) for (const it of c1.states[i].items) { const k = it.p + '.' + it.dot + '.' + it.la; if (!seen.has(k)) { seen.add(k); items.push(it); } }
      return { kernel: c1.states[g[0]].kernel, items, from: g };
    });
    const tseen = new Set(), trans = [];
    for (const t of c1.trans) { const k = map[t.from] + '|' + t.sym; if (!tseen.has(k)) { tseen.add(k); trans.push({ from: map[t.from], sym: t.sym, to: map[t.to] }); } }
    return { states, trans, merged: order.filter((g) => g.length > 1) };
  }

  // Groups LR(1) items that share a core for display: [A → α•β, a/b]
  function lr1Lines(GA, st) {
    const m = new Map();
    for (const it of st.items) { const k = it.p + '.' + it.dot; if (!m.has(k)) m.set(k, { it, las: [] }); if (!m.get(k).las.includes(it.la)) m.get(k).las.push(it.la); }
    return [...m.values()].map(({ it, las }) => `[${itemStr(GA, it)}, ${las.join('/')}]`);
  }

  // ---------- LR tables ----------
  function lrTable(GA, coll, kind, ff) {
    const terms = [...GA.orig.terms, END];
    const nts = GA.nts.slice(1);
    const action = coll.states.map(() => new Map(terms.map((a) => [a, []])));
    const go = coll.states.map(() => new Map());
    const add = (s, a, e) => { const c = action[s].get(a); if (!c.some((x) => x.t === e.t && x.v === e.v)) c.push(e); };
    for (const t of coll.trans) { if (isNT(GA, t.sym)) go[t.from].set(t.sym, t.to); else add(t.from, t.sym, { t: 's', v: t.to }); }
    coll.states.forEach((st, s) => {
      for (const it of st.items) {
        const p = GA.prods[it.p];
        if (it.dot < p.rhs.length) continue;
        if (it.p === 0) { add(s, END, { t: 'acc' }); continue; }
        const las = kind === 'slr' ? ff.FOLLOW.get(p.lhs) : kind === 'lr0' ? terms : [it.la];
        for (const a of las) add(s, a, { t: 'r', v: it.p });
      }
    });
    const conflicts = [];
    action.forEach((row, s) => row.forEach((c, a) => { if (c.length > 1) conflicts.push({ s, a, entries: [...c], type: c.every((e) => e.t === 'r') ? 'reduce/reduce' : 'shift/reduce' }); }));
    return { kind, action, go, terms, nts, conflicts };
  }
  const entryStr = (e) => (e.t === 's' ? 's' + e.v : e.t === 'r' ? 'r' + e.v : 'acc');

  // ---------- precedence declarations (yacc style) ----------
  function parsePrecedence(text) {
    const levels = [];
    const tokPrec = new Map();
    text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const m = line.match(/^%?(left|right|nonassoc)\s+(.+)$/i);
      if (!m) throw new Error(`Cannot read precedence line "${line}". Use  %left + -  or  %right ^`);
      const assoc = m[1].toLowerCase();
      const toks = m[2].split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean);
      levels.push({ assoc, toks });
      toks.forEach((t) => tokPrec.set(t, { level: levels.length, assoc }));
    });
    return { levels, tokPrec };
  }
  function prodPrec(GA, pi, prec) {
    const rhs = GA.prods[pi].rhs;
    for (let k = rhs.length - 1; k >= 0; k--) if (prec.tokPrec.has(rhs[k])) return { ...prec.tokPrec.get(rhs[k]), tok: rhs[k] };
    return null;
  }
  // Resolves conflicts the way yacc does; returns a new table and a log of each decision.
  function resolveConflicts(GA, table, prec) {
    const action = table.action.map((row) => new Map([...row].map(([a, c]) => [a, [...c]])));
    const log = [];
    action.forEach((row, s) => row.forEach((c, a) => {
      if (c.length < 2) return;
      const shifts = c.filter((e) => e.t === 's'), reds = c.filter((e) => e.t === 'r').sort((x, y) => x.v - y.v);
      let keep = [...c];
      let reason = '';
      if (reds.length > 1) {
        keep = [...shifts, reds[0]];
        reason = `reduce/reduce: keep the earlier production ${prodStr(GA.prods[reds[0].v])} (yacc rule).`;
        log.push({ s, a, before: c.map(entryStr).join(' / '), after: keep.map(entryStr).join(' / '), reason });
      }
      if (shifts.length && keep.some((e) => e.t === 'r')) {
        const r = keep.find((e) => e.t === 'r');
        const pp = prodPrec(GA, r.v, prec), tp = prec.tokPrec.get(a);
        let res;
        if (!pp || !tp) { res = 'shift'; reason = `no precedence for ${!tp ? `'${a}'` : prodStr(GA.prods[r.v])}, so shift by default (this is how the dangling else is resolved).`; }
        else if (tp.level > pp.level) { res = 'shift'; reason = `'${a}' binds tighter than '${pp.tok}' in ${prodStr(GA.prods[r.v])}, so shift.`; }
        else if (tp.level < pp.level) { res = 'reduce'; reason = `'${pp.tok}' in ${prodStr(GA.prods[r.v])} binds tighter than '${a}', so reduce.`; }
        else if (tp.assoc === 'left') { res = 'reduce'; reason = `'${a}' and '${pp.tok}' have the same precedence and are left-associative, so reduce.`; }
        else if (tp.assoc === 'right') { res = 'shift'; reason = `'${a}' and '${pp.tok}' have the same precedence and are right-associative, so shift.`; }
        else { res = 'error'; reason = `'${a}' is nonassociative, so the cell becomes an error.`; }
        const before = keep.map(entryStr).join(' / ');
        keep = res === 'shift' ? shifts : res === 'reduce' ? [r] : [];
        log.push({ s, a, before, after: keep.map(entryStr).join(' / ') || 'error', reason });
      }
      row.set(a, keep);
    }));
    const conflicts = [];
    action.forEach((row, s) => row.forEach((c, a) => { if (c.length > 1) conflicts.push({ s, a, entries: [...c] }); }));
    return { ...table, action, conflicts, resolved: log };
  }

  function lrParse(GA, table, tokens, limit = 3000) {
    const input = [...tokens, END];
    const stack = [0], syms = [];
    const rows = [];
    let ip = 0, ok = false, error = null;
    for (let step = 0; step < limit; step++) {
      const s = stack[stack.length - 1], a = input[ip];
      const row = { stack: stackStr(stack, syms), input: input.slice(ip), action: '' };
      rows.push(row);
      const cell = table.action[s].get(a) || [];
      if (!cell.length) { row.action = `error: ACTION[${s}, ${a}] is empty`; error = row.action; break; }
      const e = cell.find((x) => x.t === 's') || cell[0];
      const note = cell.length > 1 ? ' (conflict: shift preferred)' : '';
      if (e.t === 'acc') { row.action = 'accept'; ok = true; break; }
      if (e.t === 's') { stack.push(e.v); syms.push(a); ip++; row.action = `shift ${e.v}` + note; continue; }
      const p = GA.prods[e.v];
      const n = p.rhs.length;
      const handle = syms.slice(syms.length - n);
      stack.splice(stack.length - n, n); syms.splice(syms.length - n, n);
      const g = table.go[stack[stack.length - 1]].get(p.lhs);
      if (g === undefined) { row.action = `error: no GOTO for ${p.lhs}`; error = row.action; break; }
      stack.push(g); syms.push(p.lhs);
      row.action = `reduce by ${prodStr(p)}` + note;
      row.handle = handle.length ? handle.join(' ') : EPS;
    }
    if (!ok && !error) error = 'step limit reached';
    return { rows, accepted: ok, error };
  }
  function stackStr(stack, syms) {
    const out = [String(stack[0])];
    for (let i = 0; i < syms.length; i++) out.push(syms[i], String(stack[i + 1]));
    return out.join(' ');
  }

  // ---------- operator precedence parsing ----------
  function operatorPrecedence(G, prec) {
    const problems = [];
    for (const p of G.prods) {
      if (!p.rhs.length) problems.push(`${prodStr(p)} is an ε-production.`);
      for (let i = 0; i + 1 < p.rhs.length; i++) if (isNT(G, p.rhs[i]) && isNT(G, p.rhs[i + 1])) problems.push(`${prodStr(p)} has two adjacent nonterminals.`);
    }
    if (problems.length) return { ok: false, problems };
    const LEAD = new Map(G.nts.map((A) => [A, new Set()])), TRAIL = new Map(G.nts.map((A) => [A, new Set()]));
    for (let ch = true; ch;) {
      ch = false;
      for (const p of G.prods) {
        const L = LEAD.get(p.lhs), T = TRAIL.get(p.lhs), b1 = L.size, b2 = T.size;
        const r = p.rhs, n = r.length;
        if (!isNT(G, r[0])) L.add(r[0]); else { LEAD.get(r[0]).forEach((a) => L.add(a)); if (n > 1 && !isNT(G, r[1])) L.add(r[1]); }
        if (!isNT(G, r[n - 1])) T.add(r[n - 1]); else { TRAIL.get(r[n - 1]).forEach((a) => T.add(a)); if (n > 1 && !isNT(G, r[n - 2])) T.add(r[n - 2]); }
        if (L.size !== b1 || T.size !== b2) ch = true;
      }
    }
    const terms = [...G.terms, END];
    const R = new Map(terms.map((a) => [a, new Map(terms.map((b) => [b, new Set()]))]));
    const rel = (a, b, r) => R.get(a).get(b).add(r);
    for (const p of G.prods) {
      const r = p.rhs;
      for (let i = 0; i < r.length; i++) {
        const X = r[i], Y = r[i + 1], Z = r[i + 2];
        if (Y !== undefined && !isNT(G, X) && !isNT(G, Y)) rel(X, Y, '=');
        if (Z !== undefined && !isNT(G, X) && isNT(G, Y) && !isNT(G, Z)) rel(X, Z, '=');
        if (Y !== undefined && !isNT(G, X) && isNT(G, Y)) LEAD.get(Y).forEach((b) => rel(X, b, '<'));
        if (Y !== undefined && isNT(G, X) && !isNT(G, Y)) TRAIL.get(X).forEach((a) => rel(a, Y, '>'));
      }
    }
    LEAD.get(G.start).forEach((b) => rel(END, b, '<'));
    TRAIL.get(G.start).forEach((a) => rel(a, END, '>'));
    // Ambiguous operator grammars give both <· and ·> between operators; precedence declarations decide.
    const resolved = [];
    if (prec && prec.tokPrec.size) {
      for (const a of terms) for (const b of terms) {
        const c = R.get(a).get(b);
        if (c.size < 2) continue;
        const pa = prec.tokPrec.get(a), pb = prec.tokPrec.get(b);
        if (!pa || !pb) continue;
        let r;
        if (pa.level > pb.level) r = '>'; else if (pa.level < pb.level) r = '<';
        else r = pa.assoc === 'left' ? '>' : pa.assoc === 'right' ? '<' : null;
        R.get(a).set(b, new Set(r ? [r] : []));
        resolved.push({ a, b, r: r || 'error' });
      }
    }
    const conflicts = [];
    for (const a of terms) for (const b of terms) if (R.get(a).get(b).size > 1) conflicts.push({ a, b, rels: [...R.get(a).get(b)] });
    return { ok: true, LEAD, TRAIL, R, terms, conflicts, resolved };
  }
  const relSym = { '<': '⋖', '=': '≐', '>': '⋗' };
  function opPrecParse(op, tokens, limit = 2000) {
    const input = [...tokens, END];
    const stack = [END];
    const rows = [];
    let ip = 0, ok = false, error = null;
    const topTerm = () => stack[stack.length - 1];
    for (let step = 0; step < limit; step++) {
      const a = topTerm(), b = input[ip];
      const row = { stack: stack.join(' '), input: input.slice(ip), rel: '', action: '' };
      rows.push(row);
      if (a === END && b === END) { row.action = 'accept'; ok = true; break; }
      const r = [...(op.R.get(a)?.get(b) || [])][0];
      row.rel = r ? `${a} ${relSym[r]} ${b}` : `${a} ? ${b}`;
      if (r === '<' || r === '=') { stack.push(b); ip++; row.action = 'shift'; continue; }
      if (r === '>') {
        const handle = [];
        let popped;
        do { popped = stack.pop(); handle.unshift(popped); } while (stack.length && ![...(op.R.get(topTerm())?.get(popped) || [])].includes('<'));
        row.action = `reduce ${handle.join(' ')}`;
        if (!stack.length) { error = 'stack underflow'; break; }
        continue;
      }
      row.action = 'error: no relation'; error = row.action; break;
    }
    if (!ok && !error) error = 'step limit reached';
    return { rows, accepted: ok, error };
  }

  // ---------- disambiguating an expression grammar ----------
  // E -> E op E | atoms   becomes one level per precedence group, lowest first.
  function disambiguate(G, prec) {
    const A = G.start;
    const mine = G.prods.filter((p) => p.lhs === A);
    const bin = mine.filter((p) => p.rhs.length === 3 && p.rhs[0] === A && p.rhs[2] === A && !isNT(G, p.rhs[1]));
    if (!bin.length) throw new Error(`No productions of the form ${A} → ${A} op ${A} were found for the start symbol.`);
    const ops = [...new Set(bin.map((p) => p.rhs[1]))];
    const missing = ops.filter((o) => !prec.tokPrec.has(o));
    if (missing.length) throw new Error(`Declare precedence for ${missing.map((m) => `'${m}'`).join(', ')}, for example  %left ${missing.join(' ')}`);
    const levels = prec.levels.map((l) => ({ assoc: l.assoc, ops: l.toks.filter((t) => ops.includes(t)) })).filter((l) => l.ops.length);
    const atoms = mine.filter((p) => !bin.includes(p));
    const used = new Set([...G.nts, ...G.terms]);
    const pool = ['T', 'F', 'P', 'Q', 'U', 'V', 'W', 'X', 'Y', 'Z', 'G', 'H', 'K', 'M', 'N'];
    const names = [A];
    for (let i = 0; i < levels.length; i++) { const n = pool.find((x) => !used.has(x)); used.add(n); names.push(n); }
    const prods = [];
    levels.forEach((lv, i) => {
      const L = names[i], N = names[i + 1];
      for (const op of lv.ops) {
        if (lv.assoc === 'left') prods.push({ lhs: L, rhs: [L, op, N] });
        else if (lv.assoc === 'right') prods.push({ lhs: L, rhs: [N, op, L] });
        else prods.push({ lhs: L, rhs: [N, op, N] });
      }
      prods.push({ lhs: L, rhs: [N] });
    });
    const atomName = names[names.length - 1];
    for (const p of atoms) prods.push({ lhs: atomName, rhs: [...p.rhs] });
    for (const p of G.prods) if (p.lhs !== A) prods.push({ lhs: p.lhs, rhs: [...p.rhs] });
    const nts = [...names, ...G.nts.filter((n) => n !== A)];
    return { G: build(A, nts, prods), levels: levels.map((l, i) => ({ ...l, name: names[i] })), atomName };
  }

  // ---------- language samples, for checking parsers ----------
  function enumerate(G, maxLen, capForms = 40000, capStrings = 400) {
    const ml = new Map(G.nts.map((A) => [A, Infinity]));
    for (let ch = true; ch;) { ch = false; for (const p of G.prods) { let s = 0; for (const x of p.rhs) s += isNT(G, x) ? ml.get(x) : 1; if (s < ml.get(p.lhs)) { ml.set(p.lhs, s); ch = true; } } }
    const out = new Map(), seen = new Set([G.start]), q = [[G.start]];
    let n = 0, truncated = false;
    while (q.length) {
      if (++n > capForms || out.size >= capStrings) { truncated = true; break; }
      const form = q.shift();
      const i = form.findIndex((s) => isNT(G, s));
      if (i < 0) { out.set(form.join(' '), form); continue; }
      for (const p of G.prods) {
        if (p.lhs !== form[i]) continue;
        const nf = [...form.slice(0, i), ...p.rhs, ...form.slice(i + 1)];
        let need = 0;
        for (const x of nf) need += isNT(G, x) ? ml.get(x) : 1;
        if (need > maxLen || nf.length > 3 * maxLen + 6) continue;
        const k = nf.join(' ');
        if (!seen.has(k)) { seen.add(k); q.push(nf); }
      }
    }
    return { list: [...out.values()], truncated };
  }
  // Accepts every sampled sentence and rejects every other short token string.
  function checkRecognizer(G, accepts, maxLen = 6, negLen = 4) {
    const pos = enumerate(G, maxLen);
    const inL = new Set(pos.list.map((x) => x.join(' ')));
    let bad = null;
    for (const w of pos.list) if (!accepts(w)) { bad = { w, expected: true }; break; }
    let negatives = 0;
    if (!bad && !pos.truncated) {
      const T = G.terms;
      const cap = 3000;
      let frontier = [[]];
      outer: for (let len = 0; len <= negLen; len++) {
        for (const w of frontier) {
          if (negatives > cap) break outer;
          if (w.length === len && !inL.has(w.join(' ')) && len <= maxLen) {
            negatives++;
            if (accepts(w)) { bad = { w, expected: false }; break outer; }
          }
        }
        if (len < negLen) frontier = frontier.flatMap((w) => T.map((t) => [...w, t]));
        if (frontier.length > cap) break;
      }
    }
    return { ok: !bad, positives: pos.list.length, negatives, truncated: pos.truncated, bad, maxLen };
  }

  function tokenizeInput(text, G) {
    const terms = [...G.terms].sort((a, b) => b.length - a.length);
    const out = [];
    let i = 0;
    const s = text.trim();
    if (EPS_WORDS.has(s)) return out;
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue; }
      const t = terms.find((x) => s.startsWith(x, i));
      if (!t) throw new Error(`"${s.slice(i, i + 8)}" does not start with any terminal of the grammar (${G.terms.join(' ')}).`);
      out.push(t); i += t.length;
    }
    return out;
  }

  DT.parsing = {
    END, tokenizeAlt, parseGrammar, build, seqStr, prodStr, setStr, grammarText, grouped, firstFollow, leftRecursive, removeLeftRecursion, leftFactor,
    ll1, predictiveParse, recursiveDescent, recursiveTrace, augment, itemStr, lr0Collection, lr1Collection, lalrFromLr1, lr1Lines, lrTable, entryStr,
    parsePrecedence, resolveConflicts, lrParse, operatorPrecedence, opPrecParse, relSym, disambiguate, enumerate, checkRecognizer, tokenizeInput, isNT
  };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
