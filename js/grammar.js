/* Grammars: parsing, regular grammar → FA, CFG derivations / parse trees / ambiguity, CFG → NPDA, NPDA simulation */
(function (DT) {
  'use strict';
  const EPS = DT.EPS;
  const isVar = (t) => /^[A-Z]/.test(t);

  /* Variables: an uppercase letter + optional digits/primes (S, A1, B'). Terminals: any other single char. */
  function tokenize(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (/\s/.test(c)) continue;
      if (DT.isEps(c)) continue;
      if (/[A-Z]/.test(c)) {
        let j = i + 1;
        while (j < s.length && /[0-9'’_]/.test(s[j])) j++;
        out.push(s.slice(i, j).replace('’', "'"));
        i = j - 1;
      } else out.push(c);
    }
    return out;
  }

  function parse(text) {
    const prods = [], order = [];
    let last = null;
    const lines = text.split(/\n|;/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('#'));
    if (!lines.length) throw new Error('Grammar is empty. Write productions like  S -> aSb | λ');
    for (const line of lines) {
      let lhs, rhsText;
      const m = line.match(/^(.*?)(->|→|=>|::=|⟶|—>|-->)(.*)$/);
      if (m) {
        const lt = tokenize(m[1]);
        if (lt.length !== 1 || !isVar(lt[0])) throw new Error(`Left side "${m[1].trim()}" must be one variable (capital letter, like S or A1).`);
        lhs = lt[0]; rhsText = m[3];
      } else if (line.startsWith('|') && last) { lhs = last; rhsText = line.slice(1); }
      else throw new Error(`Cannot read "${line}". Use the form  A -> aB | b`);
      last = lhs;
      if (!order.includes(lhs)) order.push(lhs);
      for (const alt of rhsText.split('|')) {
        const rhs = tokenize(alt);
        if (!prods.some((p) => p.lhs === lhs && p.rhs.join(' ') === rhs.join(' '))) prods.push({ lhs, rhs });
      }
    }
    const vars = [...order];
    const terms = new Set();
    for (const p of prods) for (const t of p.rhs) { if (isVar(t)) { if (!vars.includes(t)) vars.push(t); } else terms.add(t); }
    const undefinedVars = vars.filter((v) => !order.includes(v));
    return { start: order[0], vars, terms: [...terms].sort(), prods, undefinedVars };
  }

  const rhsStr = (rhs) => (rhs.length ? rhs.join('') : EPS);
  function grouped(G) {
    const m = new Map();
    for (const v of G.vars) m.set(v, []);
    for (const p of G.prods) m.get(p.lhs).push(rhsStr(p.rhs));
    return [...m.entries()].filter(([, r]) => r.length).map(([lhs, rhs]) => ({ lhs, rhs }));
  }

  function classify(G) {
    let right = true, left = true;
    for (const p of G.prods) {
      const vi = p.rhs.map((t, i) => (isVar(t) ? i : -1)).filter((i) => i >= 0);
      if (vi.length > 1) { right = left = false; break; }
      if (vi.length === 1) { if (vi[0] !== p.rhs.length - 1) right = false; if (vi[0] !== 0) left = false; }
    }
    return { right, left, regular: right || left };
  }

  /* Linz Thm 3.3 construction: one state per variable + final state, chains for multi-symbol strings */
  function rightLinearToNFA(G) {
    const labels = [...G.vars];
    let fName = 'F', k = 1; while (labels.includes(fName)) fName = 'F' + k++;
    labels.push(fName);
    const idx = new Map(labels.map((l, i) => [l, i]));
    const qf = idx.get(fName);
    const trans = [], steps = [];
    let mid = 0;
    const newState = () => { let nm; do { nm = 'm' + ++mid; } while (labels.includes(nm)); labels.push(nm); return labels.length - 1; };
    for (const p of G.prods) {
      const w = p.rhs.filter((t) => !isVar(t));
      const B = p.rhs.length && isVar(p.rhs[p.rhs.length - 1]) ? p.rhs[p.rhs.length - 1] : null;
      const target = B ? idx.get(B) : qf;
      const added = [];
      if (!w.length) { trans.push({ from: idx.get(p.lhs), sym: EPS, to: target }); added.push(`δ(${p.lhs}, ${EPS}) = ${labels[target]}`); }
      else {
        let cur = idx.get(p.lhs);
        w.forEach((c, i) => {
          const nxt = i === w.length - 1 ? target : newState();
          trans.push({ from: cur, sym: c, to: nxt });
          added.push(`δ(${labels[cur]}, ${c}) = ${labels[nxt]}`);
          cur = nxt;
        });
      }
      steps.push({ prod: `${p.lhs} → ${rhsStr(p.rhs)}`, added });
    }
    return { fa: { n: labels.length, start: idx.get(G.start), finals: new Set([qf]), trans, labels }, steps, finalName: fName };
  }

  function regularToNFA(G) {
    const c = classify(G);
    if (!c.regular) throw new Error('This grammar is neither right-linear nor left-linear, so this method does not apply. (Use the CFG tab for it.)');
    if (c.right) return { kind: 'right', ...rightLinearToNFA(G) };
    // left-linear: reverse every right side → right-linear grammar for L^R → NFA → reverse NFA
    const Gr = { ...G, prods: G.prods.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs].reverse() })) };
    const built = rightLinearToNFA(Gr);
    const rv = DT.fa.reverse(built.fa);
    return { kind: 'left', reversedGrammar: Gr, revNFA: built, steps: built.steps, fa: rv.fa, note: rv.note };
  }

  // CFG tools
  function minLens(G) {
    const m = new Map(G.vars.map((v) => [v, Infinity]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of G.prods) {
        let s = 0;
        for (const t of p.rhs) s += isVar(t) ? m.get(t) : 1;
        if (s < m.get(p.lhs)) { m.set(p.lhs, s); changed = true; }
      }
    }
    return m;
  }

  /* Find up to `limit` distinct leftmost derivations of w. Returns {derivs:[[prodIdx...]], hitBudget} */
  function derive(G, w, limit = 2, budget = 250000) {
    const W = [...w];
    const ml = minLens(G);
    const byLhs = new Map();
    G.prods.forEach((p, i) => { if (!byLhs.has(p.lhs)) byLhs.set(p.lhs, []); byLhs.get(p.lhs).push(i); });
    const cap = 3 * W.length + 8;
    let nodes = 0, hitBudget = false;
    const memo = new Map(), inProg = new Set();
    function dfs(form) {
      if (++nodes > budget) { hitBudget = true; return []; }
      if (form.length > cap) return [];
      let i = 0;
      while (i < form.length && !isVar(form[i])) i++;
      if (i > W.length) return [];
      for (let j = 0; j < i; j++) if (form[j] !== W[j]) return [];
      if (i === form.length) return form.length === W.length ? [[]] : [];
      let need = 0;
      for (const s of form) need += isVar(s) ? ml.get(s) : 1;
      if (need > W.length) return [];
      for (let j = form.length - 1, k = W.length - 1; j >= 0 && !isVar(form[j]); j--, k--) if (form[j] !== W[k]) return [];
      const key = form.join(' ');
      if (memo.has(key)) return memo.get(key);
      if (inProg.has(key)) return [];
      inProg.add(key);
      const res = [];
      for (const pi of byLhs.get(form[i]) || []) {
        const nf = [...form.slice(0, i), ...G.prods[pi].rhs, ...form.slice(i + 1)];
        for (const s of dfs(nf)) { res.push([pi, ...s]); if (res.length >= limit) break; }
        if (res.length >= limit || hitBudget) break;
      }
      inProg.delete(key);
      if (!hitBudget) memo.set(key, res);
      return res;
    }
    const derivs = dfs([G.start]);
    return { derivs, hitBudget };
  }

  /* Replay a leftmost derivation: sentential forms + parse tree */
  function replay(G, seq) {
    let uid = 0;
    const mk = (sym) => ({ id: uid++, sym, kids: null });
    const root = mk(G.start);
    let form = [root];
    const forms = [{ form: G.start, prod: null }];
    for (const pi of seq) {
      const p = G.prods[pi];
      const i = form.findIndex((x) => isVar(x.sym) && !x.kids);
      const node = form[i];
      node.kids = p.rhs.length ? p.rhs.map(mk) : [mk(EPS)];
      form = [...form.slice(0, i), ...node.kids.filter((x) => x.sym !== EPS), ...form.slice(i + 1)];
      forms.push({ form: form.map((x) => x.sym).join('') || EPS, prod: `${p.lhs} → ${rhsStr(p.rhs)}` });
    }
    return { tree: root, forms };
  }
  /* Rightmost derivation for the same parse tree */
  function rightmostForms(tree) {
    let form = [tree];
    const forms = [{ form: tree.sym, prod: null }];
    for (;;) {
      let i = -1;
      for (let j = form.length - 1; j >= 0; j--) if (form[j].kids) { i = j; break; }
      if (i < 0) break;
      const node = form[i];
      form = [...form.slice(0, i), ...node.kids.filter((x) => x.sym !== EPS), ...form.slice(i + 1)];
      forms.push({ form: form.map((x) => x.sym).join('') || EPS, prod: `${node.sym} → ${node.kids.map((k) => k.sym).join('')}` });
    }
    return forms;
  }

  /* Strings of L(G) up to length L (BFS over leftmost sentential forms) */
  function enumerate(G, L, capForms = 60000, capStrings = 300) {
    const ml = minLens(G);
    const out = new Set(), seen = new Set([G.start]), q = [[G.start]];
    let n = 0, truncated = false;
    while (q.length) {
      if (++n > capForms || out.size >= capStrings) { truncated = true; break; }
      const form = q.shift();
      const i = form.findIndex(isVar);
      if (i < 0) { out.add(form.join('')); continue; }
      for (const p of G.prods) {
        if (p.lhs !== form[i]) continue;
        const nf = [...form.slice(0, i), ...p.rhs, ...form.slice(i + 1)];
        let need = 0;
        for (const s of nf) need += isVar(s) ? ml.get(s) : 1;
        if (need > L || nf.length > 3 * L + 8) continue;
        const k = nf.join(' ');
        if (!seen.has(k)) { seen.add(k); q.push(nf); }
      }
    }
    const list = [...out].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    return { list, truncated };
  }

  function findAmbiguity(G, L) {
    const { list, truncated } = enumerate(G, L);
    let checked = 0;
    for (const w of list) {
      checked++;
      const r = derive(G, w, 2, 60000);
      if (r.derivs.length >= 2) return { found: true, w, derivs: r.derivs, checked };
    }
    return { found: false, checked, truncated };
  }

  function isGNF(G) {
    return G.prods.every((p) => (p.rhs.length === 0 && p.lhs === G.start) || (p.rhs.length >= 1 && !isVar(p.rhs[0]) && p.rhs.slice(1).every(isVar)));
  }

  // NPDA
  // transition: {from, inp, pop, to, push:[tokens]}; inp/pop may be EPS
  function cfgToPDA(G) {
    let z = 'z';
    if (G.terms.includes('z')) z = '#';
    const trans = [], notes = [];
    const gnf = isGNF(G);
    trans.push({ from: 'q0', inp: EPS, pop: z, to: 'q1', push: [G.start, z], why: 'start: push S on top of z' });
    if (gnf) {
      for (const p of G.prods) {
        if (!p.rhs.length) trans.push({ from: 'q1', inp: EPS, pop: p.lhs, to: 'q1', push: [], why: `${p.lhs} → ${EPS}` });
        else trans.push({ from: 'q1', inp: p.rhs[0], pop: p.lhs, to: 'q1', push: p.rhs.slice(1), why: `${p.lhs} → ${rhsStr(p.rhs)}` });
      }
      notes.push('Grammar is in Greibach normal form, so each production A → aw becomes δ(q1, a, A) ∋ (q1, w).');
    } else {
      for (const p of G.prods) trans.push({ from: 'q1', inp: EPS, pop: p.lhs, to: 'q1', push: [...p.rhs], why: `${p.lhs} → ${rhsStr(p.rhs)}` });
      for (const a of G.terms) trans.push({ from: 'q1', inp: a, pop: a, to: 'q1', push: [], why: `match terminal ${a}` });
      notes.push('Grammar is not in Greibach normal form, so the general construction is used: δ(q1, λ, A) ∋ (q1, w) for every A → w, and δ(q1, a, a) = (q1, λ) for every terminal a.');
    }
    trans.push({ from: 'q1', inp: EPS, pop: z, to: 'qf', push: [], why: 'stack back to z: accept' });
    return { states: ['q0', 'q1', 'qf'], start: 'q0', z, finals: ['qf'], trans, gnf, notes, stackSyms: [...new Set([z, ...G.vars, ...(gnf ? [] : G.terms)])], inputSyms: G.terms };
  }

  function parsePDA(text) {
    const trans = [];
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    for (const line of lines) {
      const m = line.match(/^(.*?)(=|->|→)(.*)$/);
      if (!m) throw new Error(`Cannot read "${line}". Use  δ(q0, a, z) = {(q0, az)}`);
      const left = m[1].replace(/δ|delta/gi, '').replace(/[()]/g, '').split(',').map((s) => s.trim());
      if (left.length !== 3) throw new Error(`Left side of "${line}" needs (state, input, stack top).`);
      const [from, inp, pop] = left;
      const rhs = m[3];
      let groups = [...rhs.matchAll(/\(([^()]*)\)/g)].map((g) => g[1]);
      if (!groups.length) groups = [rhs.replace(/[{}]/g, '')];
      for (const g of groups) {
        const parts = g.split(',').map((s) => s.trim());
        if (parts.length !== 2) throw new Error(`Right side "(${g})" needs (state, push string).`);
        trans.push({ from, inp: DT.isEps(inp) ? EPS : inp, pop: DT.isEps(pop) ? EPS : pop, to: parts[0], push: tokenize(parts[1]) });
      }
    }
    return trans;
  }
  function pdaText(trans) {
    const m = new Map();
    for (const t of trans) {
      const k = `δ(${t.from}, ${t.inp}, ${t.pop})`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(`(${t.to}, ${t.push.length ? t.push.join('') : EPS})`);
    }
    return [...m.entries()].map(([k, v]) => `${k} = {${v.join(', ')}}`).join('\n');
  }

  function simulatePDA(pda, w, mode = 'final', budget = 200000) {
    const W = [...w];
    const cap = 2 * W.length + 12;
    const finals = new Set(pda.finals);
    const start = { s: pda.start, i: 0, st: [pda.z] };
    const key = (c) => c.s + '|' + c.i + '|' + c.st.join(' ');
    const parent = new Map([[key(start), null]]);
    const q = [start];
    let n = 0, hitBudget = false;
    const ok = (c) => c.i === W.length && (mode === 'final' ? finals.has(c.s) : c.st.length === 0);
    while (q.length) {
      if (++n > budget) { hitBudget = true; break; }
      const c = q.shift();
      if (ok(c)) {
        const path = [];
        for (let k = key(c), cc = c; cc; ) { path.unshift(cc); const p = parent.get(k); if (!p) break; cc = p.c; k = key(cc); }
        return { accepted: true, path, explored: n };
      }
      for (const t of pda.trans) {
        if (t.from !== c.s) continue;
        if (t.inp !== EPS && t.inp !== W[c.i]) continue;
        if (t.pop !== EPS && c.st[0] !== t.pop) continue;
        const st = [...t.push, ...(t.pop === EPS ? c.st : c.st.slice(1))];
        if (st.length > cap) continue;
        const nc = { s: t.to, i: c.i + (t.inp === EPS ? 0 : 1), st };
        const k = key(nc);
        if (!parent.has(k)) { parent.set(k, { c }); q.push(nc); }
      }
    }
    return { accepted: false, explored: n, hitBudget };
  }
  const idStr = (c, W) => `(${c.s}, ${W.slice(c.i).join('') || EPS}, ${c.st.join('') || EPS})`;

  DT.grammar = { isVar, tokenize, parse, grouped, rhsStr, classify, regularToNFA, minLens, derive, replay, rightmostForms, enumerate, findAmbiguity, isGNF, cfgToPDA, parsePDA, pdaText, simulatePDA, idStr };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
