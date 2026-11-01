/* Parsing tool (syntax analysis), including simplification and CNF. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, EPS, esc, $, $$, store, showErr, nextId, rerenders, stage, chip, blank, emptyState, LEARN_MAX } = App;
  // PARSING (syntax analysis)
  const PS = DT.parsing;
  let lastPsOp = 'ff';
  const grammars = new Map();
  const okChip = (t) => `<span class="chip ok">✓ ${esc(t)}</span>`;
  const badChip = (t) => `<span class="chip bad">✗ ${esc(t)}</span>`;
  const psSet = (S, order) => esc(PS.setStr(S, order));
  const gramBlock = (G) => `<div class="prods">${PS.grouped(G).map((g) => `<span class="v">${esc(g.lhs)}</span> → ${g.rhs.map(esc).join(' | ')}`).join('\n')}</div>`;
  const useBtn = (G, text = 'Use this grammar') => { const id = 'G' + nextId(); grammars.set(id, G); return `<button type="button" class="ghost" data-usegram="${id}">${text}</button>`; };
  const psBtn = (op, text) => `<button type="button" class="ghost" data-psgo="${op}">${text}</button>`;
  const grid = (head, rows, sepAt = -1) =>
    `<div class="tbl"><table class="grid mono"><thead><tr>${head.map((h, i) => `<th${i === sepAt ? ' class="sep"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => { const o = c !== null && typeof c === 'object' ? c : { v: c }; const cls = [o.cls, i === sepAt ? 'sep' : ''].filter(Boolean).join(' '); return `<td${cls ? ` class="${cls}"` : ''}>${o.v ?? ''}</td>`; }).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
  const recogChip = (c, what) => (c.ok
    ? okChip(`${what} accepts all ${c.positives} strings of L(G) up to ${c.maxLen} tokens${c.negatives ? ` and rejects ${c.negatives} others` : ''}`)
    : badChip(`${what} ${c.bad.expected ? 'rejects' : 'accepts'} "${c.bad.w.join(' ') || EPS}" wrongly`));
  function sameStrings(G1, G2, len = 6) {
    const a = PS.enumerate(G1, len), b = PS.enumerate(G2, len);
    const A = new Set(a.list.map((x) => x.join(' '))), B = new Set(b.list.map((x) => x.join(' ')));
    const diff = [...A].find((x) => !B.has(x)) ?? [...B].find((x) => !A.has(x));
    return { eq: diff === undefined, n: A.size, len, truncated: a.truncated || b.truncated, witness: diff };
  }
  const sameChip = (r) => (r.eq ? okChip(`generates the same ${r.n} strings up to ${r.len} tokens${r.truncated ? ' (sampled)' : ''}`) : badChip(`differs on "${r.witness || EPS}"`));
  const numberedProds = (GA) => `<div class="prods">${GA.prods.map((p, i) => `<span class="v">${i}.</span> ${esc(PS.prodStr(p))}`).join('\n')}</div>`;
  function psTokens(G) {
    try { return { toks: PS.tokenizeInput($('#psW').value, G) }; } catch (e) { return { err: e.message }; }
  }
  function traceTable(head, rows, accepted) {
    return `<div class="tbl"><table class="mono trace"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r, i) => `<tr${i === rows.length - 1 ? (accepted ? ' class="done"' : ' class="bad"') : ''}>${r.map((c, k) => `<td${k === r.length - 1 || (head[k] === 'Action') ? ' class="act"' : ''}>${c}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;
  }
  const inputCell = (arr) => esc(arr.join(' '));

  function psFirstFollow(G) {
    const ff = PS.firstFollow(G);
    const rows = G.nts.map((A) => [`<b>${esc(A)}</b>`, psSet(ff.FIRST.get(A), ff.symOrder), psSet(ff.FOLLOW.get(A), ff.termOrder)]);
    const passRows = (passes, order) => passes.map((m, k) => [`pass ${k + 1}`, ...G.nts.map((A) => psSet(m.get(A), order))]);
    const prodRows = G.prods.map((p) => [esc(PS.prodStr(p)), psSet(ff.firstSeq(p.rhs), ff.symOrder)]);
    return stage('ps-ff', '', 'FIRST and FOLLOW', chip('nonterminals', G.nts.length),
      `<div class="formula">FIRST(X → Y1…Yk): add FIRST(Y1) − {${EPS}}, move to Y2 while Yi ⇒* ${EPS}; add ${EPS} if all can vanish</div>
       <div class="formula">FOLLOW: $ ∈ FOLLOW(${esc(G.start)}) · A → αBβ: FIRST(β) − {${EPS}} ⊆ FOLLOW(B) · if β ⇒* ${EPS}: FOLLOW(A) ⊆ FOLLOW(B)</div>
       ${ui.table(['Nonterminal', 'FIRST', 'FOLLOW'], rows, 'mono')}
       <details><summary>FIRST of every production</summary>${ui.table(['Production', 'FIRST(α)'], prodRows, 'mono')}</details>
       <details><summary>How the sets grew, pass by pass</summary>
         <div class="sub">FIRST</div>${ui.table(['', ...G.nts.map(esc)], passRows(ff.firstPasses, ff.symOrder), 'mono')}
         <div class="sub">FOLLOW</div>${ui.table(['', ...G.nts.map(esc)], passRows(ff.followPasses, ff.termOrder), 'mono')}
         <p class="small muted">The last pass changed nothing, so the sets are final.</p></details>`);
  }

  function psLeftRec(G) {
    const r = PS.removeLeftRecursion(G);
    if (!r.changed) return stage('ps-lr', '', 'Remove left recursion', okChip('not left-recursive'), `<p>No nonterminal can derive a string that starts with itself, so nothing changes.</p>${gramBlock(G)}`);
    const steps = r.steps.map((s) => `<li>${esc(s.text)}<div class="prods" style="margin-top:6px">${s.result.map(esc).join('\n')}</div></li>`).join('');
    return stage('ps-lr', '', 'Remove left recursion', (r.remaining.length ? badChip(`still left-recursive: ${r.remaining.join(', ')}`) : okChip('no left recursion left')) + sameChip(sameStrings(G, r.G)),
      `<div class="formula">A → Aα | β  becomes  A → βA' and A' → αA' | ${EPS}  (indirect cycles are first made direct by substitution)</div>
       ${r.warnings.map((w) => `<p class="small muted">${esc(w)}</p>`).join('')}
       <ol class="steps" style="font-family:inherit;font-size:14px">${steps}</ol>
       <div class="sub">Result</div>${gramBlock(r.G)}
       <div class="btnRow">${useBtn(r.G)}</div>`);
  }

  function psLeftFactor(G) {
    const r = PS.leftFactor(G);
    if (!r.changed) return stage('ps-lf', '', 'Left factoring', okChip('nothing to factor'), `<p>No two alternatives of the same nonterminal start with the same symbol.</p>${gramBlock(G)}`);
    const steps = r.steps.map((s) => `<li>${esc(s.text)}</li>`).join('');
    return stage('ps-lf', '', 'Left factoring', sameChip(sameStrings(G, r.G)),
      `<div class="formula">A → αβ1 | αβ2  becomes  A → αA' and A' → β1 | β2</div>
       <ol class="steps" style="font-family:inherit;font-size:14px">${steps}</ol>
       <div class="sub">Result</div>${gramBlock(r.G)}
       <div class="btnRow">${useBtn(r.G)}</div>`);
  }

  function psDisambiguate(G, prec) {
    // only the E → E op E | … shape can be rewritten by precedence levels
    const head = G.prods.filter((p) => p.lhs === G.start);
    if (!head.some((p) => p.rhs.length === 3 && p.rhs[0] === G.start && p.rhs[2] === G.start)) {
      const GA0 = PS.augment(G), ff0 = PS.firstFollow(GA0);
      const n = PS.lrTable(GA0, PS.lalrFromLr1(GA0, PS.lr1Collection(GA0, ff0)), 'lalr').conflicts.length;
      return stage('ps-amb', '', 'Make the expression grammar unambiguous', n ? badChip(`${n} LALR conflicts`) : okChip('already unambiguous: LALR(1) with no conflicts'),
        `<p>This rewrite works on the classic ambiguous form <b class="mono">${esc(G.start)} → ${esc(G.start)} op ${esc(G.start)} | …</b>, turning each precedence level into its own nonterminal. ${esc(G.start)} has no production of that form, so there is nothing to rewrite${n ? '; the conflicts come from elsewhere in the grammar' : ', and the grammar already parses without conflicts'}.</p>
         <p class="small muted">Try the “ambiguous E” example.</p>`);
    }
    const r = PS.disambiguate(G, prec);
    const GA = PS.augment(r.G), ff = PS.firstFollow(GA);
    const t = PS.lrTable(GA, PS.lalrFromLr1(GA, PS.lr1Collection(GA, ff)), 'lalr');
    const levels = r.levels.map((l) => `<li><b>${esc(l.name)}</b>: ${l.ops.map((o) => `'${esc(o)}'`).join(', ')}, ${l.assoc === 'left' ? 'left-associative, so the recursion is on the left' : l.assoc === 'right' ? 'right-associative, so the recursion is on the right' : 'nonassociative'}</li>`).join('');
    return stage('ps-amb', '', 'Make the expression grammar unambiguous', (t.conflicts.length ? badChip(`${t.conflicts.length} LALR conflicts remain`) : okChip('unambiguous: LALR(1) with no conflicts')) + sameChip(sameStrings(G, r.G)),
      `<p>One nonterminal per precedence level, lowest precedence first, so tighter operators sit deeper in the parse tree and are evaluated first.</p>
       <ol class="steps" style="font-family:inherit;font-size:14px">${levels}<li><b>${esc(r.atomName)}</b>: the operands (everything that is not E op E)</li></ol>
       <div class="sub">Result</div>${gramBlock(r.G)}
       <div class="btnRow">${useBtn(r.G)}</div>`);
  }

  function psLL1(G) {
    const t = PS.ll1(G);
    const lrec = PS.leftRecursive(G);
    const rows = G.nts.filter((A) => G.prods.some((p) => p.lhs === A)).map((A) => [`<b>${esc(A)}</b>`, ...t.cols.map((a) => {
      const c = t.M.get(A).get(a);
      return { v: c.map((i) => esc(PS.prodStr(G.prods[i]))).join('<br>'), cls: c.length > 1 ? 'conflict' : '' };
    })]);
    const conflicts = t.conflicts.map((c) => `<li>M[${esc(c.A)}, ${esc(c.a)}] holds ${c.prods.map((i) => esc(PS.prodStr(G.prods[i]))).join(' and ')}: ${c.prods.map((i) => { const w = t.why[i]; return w.first.has(c.a) ? `${esc(c.a)} ∈ FIRST(${esc(PS.seqStr(G.prods[i].rhs))})` : `${esc(c.a)} ∈ FOLLOW(${esc(c.A)}) and ${EPS} ∈ FIRST(${esc(PS.seqStr(G.prods[i].rhs))})`; }).join(', ')}.</li>`).join('');
    const placed = G.prods.map((p, i) => [esc(PS.prodStr(p)), psSet(t.why[i].first, t.ff.symOrder), t.why[i].usesFollow ? `FIRST − {${EPS}}, plus FOLLOW(${esc(p.lhs)}) = ${psSet(t.ff.FOLLOW.get(p.lhs), t.ff.termOrder)}` : 'FIRST']);
    let verdict = '';
    if (t.isLL1) verdict = okChip('LL(1): no cell has two entries') + recogChip(PS.checkRecognizer(G, (w) => PS.predictiveParse(G, t, w).accepted), 'parser');
    else verdict = badChip(`not LL(1): ${t.conflicts.length} conflicting cell${t.conflicts.length > 1 ? 's' : ''}`);
    return stage('ps-ll1', '', 'LL(1) predictive parsing table', verdict,
      `<div class="formula">For A → α: add it to M[A, a] for every a ∈ FIRST(α); if ${EPS} ∈ FIRST(α), also for every b ∈ FOLLOW(A) (including $)</div>
       ${lrec.length ? `<p><b>${lrec.map(esc).join(', ')} ${lrec.length > 1 ? 'are' : 'is'} left-recursive.</b> A left-recursive grammar is never LL(1).</p><div class="btnRow">${psBtn('lr', 'Remove left recursion first')}</div>` : ''}
       ${grid(['', ...t.cols.map(esc)], rows)}
       ${conflicts ? `<div class="sub">Conflicts</div><ul class="steps" style="font-family:inherit;font-size:14px">${conflicts}</ul>` : ''}
       <details><summary>Where each production was placed</summary>${ui.table(['Production', 'FIRST(α)', 'Columns'], placed, 'mono')}</details>`);
  }

  function psPredictive(G) {
    const t = PS.ll1(G);
    const tk = psTokens(G);
    if (tk.err) return stage('ps-pp', '', 'Predictive parse', badChip('input error'), `<p>${esc(tk.err)}</p>`);
    const r = PS.predictiveParse(G, t, tk.toks);
    const rows = r.rows.map((x) => [esc(x.matched), esc(x.stack.join(' ')), inputCell(x.input), esc(x.action)]);
    return stage('ps-pp', '', `Non-recursive predictive parse of “${esc(tk.toks.join(' ') || EPS)}”`, (r.accepted ? okChip('accepted') : badChip('rejected')) + (t.isLL1 ? '' : badChip('table has conflicts')),
      `<p class="small muted">Stack top is on the right. Start with $${esc(G.start)} and w$; expand the top nonterminal using M[top, lookahead], match terminals.</p>
       ${r.rows.length <= LEARN_MAX ? DT.learn.button(DT.learn.llSteps(G, r)) : ''}
       ${traceTable(['Matched', 'Stack', 'Input', 'Action'], rows, r.accepted)}`);
  }

  function psRecursive(G) {
    const lrec = PS.leftRecursive(G);
    if (lrec.length) return stage('ps-rd', '', 'Recursive descent', badChip('left-recursive'), `<p>${lrec.map(esc).join(', ')} ${lrec.length > 1 ? 'are' : 'is'} left-recursive, so its procedure would call itself forever before reading any input.</p><div class="btnRow">${psBtn('lr', 'Remove left recursion first')}</div>`);
    const t = PS.ll1(G);
    const code = PS.recursiveDescent(G, t.ff);
    const tk = psTokens(G);
    let trace = `<p>${esc(tk.err || '')}</p>`, ok = false;
    if (!tk.err) {
      const r = PS.recursiveTrace(G, t, tk.toks);
      ok = r.accepted;
      trace = `<pre class="calls">${r.lines.map((l) => `${'  '.repeat(l.depth)}<span class="${l.bad ? 'bad' : l.ok ? 'ok' : ''}">${esc(l.text)}</span>${l.note ? `  <span class="note">${esc(l.note)}</span>` : ''}`).join('\n')}</pre>
        <p>${r.accepted ? 'All input consumed with lookahead = $, so the string is accepted.' : esc('Rejected: ' + r.error)}</p>`;
    }
    return stage('ps-rd', '', 'Recursive descent parser', (t.isLL1 ? okChip('LL(1), so one token of lookahead picks every branch') : badChip('not LL(1): some branches overlap')) + (tk.err ? '' : ok ? okChip('input accepted') : badChip('input rejected')),
      `<div class="cols"><div><div class="sub">Procedures</div><pre class="code">${esc(code)}</pre></div>
       <div><div class="sub">Trace for <span class="raw">“${esc((tk.toks || []).join(' ') || EPS)}”</span></div>${trace}</div></div>`);
  }

  function psLR(G, kind, prec, usePrec) {
    const GA = PS.augment(G), ff = PS.firstFollow(GA);
    const c0 = PS.lr0Collection(GA);
    const c1 = kind === 'clr' || kind === 'lalr' ? PS.lr1Collection(GA, ff) : null;
    const la = kind === 'lalr' ? PS.lalrFromLr1(GA, c1) : null;
    const coll = kind === 'clr' ? c1 : kind === 'lalr' ? la : c0;
    let table = PS.lrTable(GA, coll, kind, ff);
    const raw = table;
    if (usePrec && kind !== 'lr0') table = PS.resolveConflicts(GA, table, prec);
    // conflict counts for comparison
    const cSLR = PS.lrTable(GA, c0, 'slr', ff).conflicts.length;
    const c1x = c1 || PS.lr1Collection(GA, ff);
    const cCLR = PS.lrTable(GA, c1x, 'clr').conflicts.length;
    const cLALR = PS.lrTable(GA, la || PS.lalrFromLr1(GA, c1x), 'lalr').conflicts.length;
    const names = { lr0: 'LR(0)', slr: 'SLR(1)', clr: 'Canonical LR(1)', lalr: 'LALR(1)' };
    const lines = (st) => (kind === 'clr' || kind === 'lalr' ? PS.lr1Lines(GA, st) : st.items.map((it) => PS.itemStr(GA, it)));
    const conflictStates = new Set(raw.conflicts.map((c) => c.s));
    const from = new Map();
    coll.trans.forEach((t) => { if (!from.has(t.to)) from.set(t.to, `GOTO(I${t.from}, ${t.sym})`); });
    const collRows = coll.states.map((st, i) => [`<b>I${i}</b>`, esc(i === 0 ? `CLOSURE({${kind === 'clr' || kind === 'lalr' ? `[${PS.itemStr(GA, { p: 0, dot: 0 })}, $]` : PS.itemStr(GA, { p: 0, dot: 0 })}})` : from.get(i) || ''),
      lines(st).map((l, k) => (k < st.kernel ? `<b>${esc(l)}</b>` : esc(l))).join('<br>') + (st.from && st.from.length > 1 ? `<br><span class="muted">merged from LR(1) states ${st.from.join(', ')}</span>` : '')]);
    const g = {
      nodes: coll.states.map((st, i) => ({ id: i, label: `I${i}`, lines: lines(st), start: i === 0, final: st.items.some((it) => it.p === 0 && it.dot === 1), cls: conflictStates.has(i) ? 'conflict' : '' })),
      edges: coll.trans.map((t) => ({ from: t.from, to: t.to, label: t.sym }))
    };
    const actCell = (s, a) => {
      const c = table.action[s].get(a), rc = raw.action[s].get(a);
      const v = c.map((e) => (e.t === 'acc' ? 'acc' : PS.entryStr(e))).join(' / ');
      const cls = c.length > 1 ? 'conflict' : rc.length > 1 ? 'resolved' : c.some((e) => e.t === 'acc') ? 'acc' : '';
      return { v: esc(v), cls };
    };
    const rows = coll.states.map((_, s) => [`I${s}`, ...table.terms.map((a) => actCell(s, a)), ...table.nts.map((A) => (table.go[s].has(A) ? String(table.go[s].get(A)) : ''))]);
    const head = ['State', ...table.terms.map(esc), ...table.nts.map(esc)];
    const conflictList = raw.conflicts.map((c) => `<li>I${c.s} on ${esc(c.a)}: ${c.entries.map((e) => (e.t === 's' ? `shift ${e.v}` : e.t === 'r' ? `reduce ${esc(PS.prodStr(GA.prods[e.v]))}` : 'accept')).join(' vs ')} (${c.type})</li>`).join('');
    const resolved = table.resolved ? table.resolved.map((l) => `<li>I${l.s} on ${esc(l.a)}: ${esc(l.before)} → <b>${esc(l.after)}</b>. ${esc(l.reason)}</li>`).join('') : '';
    const reduceNote = kind === 'slr' ? `<details><summary>Reduce entries use FOLLOW</summary>${ui.table(['Production', 'Reduce on FOLLOW(lhs)'], GA.prods.slice(1).map((p, i) => [`r${i + 1}: ${esc(PS.prodStr(p))}`, psSet(ff.FOLLOW.get(p.lhs), ff.termOrder)]), 'mono')}</details>`
      : kind === 'lr0' ? '<p class="small muted">LR(0) reduces on every input symbol, which is why conflicts appear easily. SLR(1) only reduces on FOLLOW of the left side.</p>'
      : `<p class="small muted">Reduce entries go only under each item's own lookahead, which is what makes ${kind === 'clr' ? 'CLR' : 'LALR'} stronger than SLR.</p>`;
    const mergeNote = la && la.merged.length ? `<p class="small">Merged states with the same core: ${la.merged.map((m) => `{${m.join(', ')}}`).join(', ')} (${c1.states.length} LR(1) states became ${la.states.length}).</p>` : '';
    // trace
    const tk = psTokens(G);
    let traceHTML = `<p>${esc(tk.err || '')}</p>`, accepted = null;
    if (!tk.err && kind !== 'lr0') {
      const r = PS.lrParse(GA, table, tk.toks);
      accepted = r.accepted;
      traceHTML = (r.rows.length <= LEARN_MAX ? DT.learn.button(DT.learn.lrSteps(GA, r)) : '') + traceTable(['Stack', 'Input', 'Action', 'Handle'], r.rows.map((x) => [esc(x.stack), inputCell(x.input), esc(x.action), esc(x.handle || '')]), r.accepted);
    }
    const conflictFree = table.conflicts.length === 0;
    let meta = chip('states', coll.states.length) + (raw.conflicts.length ? badChip(`${raw.conflicts.length} conflict${raw.conflicts.length > 1 ? 's' : ''}`) : okChip(`no conflicts, the grammar is ${names[kind]}`));
    if (table.resolved && table.resolved.length) meta += conflictFree ? okChip('all conflicts resolved (precedence, then yacc defaults)') : badChip(`${table.conflicts.length} left after precedence`);
    if (conflictFree && kind !== 'lr0') meta += recogChip(PS.checkRecognizer(G, (w) => PS.lrParse(GA, table, w).accepted), 'parser');
    const cmp = `<div class="cmp"><span class="chip">SLR(1) <b>${cSLR}</b></span><span class="chip">LALR(1) <b>${cLALR}</b></span><span class="chip">CLR(1) <b>${cCLR}</b></span><span class="small muted" style="align-self:center">conflicts for this grammar</span></div>`;
    return stage('ps-' + kind, '', `${names[kind]} parser`, meta,
      `${cmp}
       <div class="cols"><div><div class="sub">Augmented grammar</div>${numberedProds(GA)}</div>
       <div><div class="sub">Items</div><p class="small muted">${kind === 'clr' || kind === 'lalr' ? `LR(1) item [A → α•β, a]: a is the lookahead. CLOSURE adds [B → •γ, b] for b ∈ FIRST(βa).` : 'Item A → α•β: the dot marks how much of the right side is on the stack. CLOSURE adds B → •γ for a nonterminal after the dot.'} Kernel items are in bold.</p></div></div>
       <details ${coll.states.length <= 16 ? 'open' : ''}><summary>Canonical collection (${coll.states.length} item sets)</summary>${ui.table(['State', 'From', 'Items'], collRows, 'mono')}</details>
       <details ${coll.states.length <= 14 ? 'open' : ''}><summary>${names[kind] === 'LALR(1)' ? 'LALR' : kind === 'clr' ? 'LR(1)' : 'LR(0)'} automaton</summary>${mergeNote}${ui.slot(g)}</details>
       <div class="sub">Parsing table${kind === 'lr0' ? ' (LR(0))' : ''}</div>
       <p class="small muted">sN = shift and go to state N, rN = reduce by production N, acc = accept. ACTION columns first, then GOTO.</p>
       ${grid(head, rows, 1 + table.terms.length)}
       ${reduceNote}
       ${conflictList ? `<div class="sub">Conflicts</div><ul class="steps" style="font-family:inherit;font-size:14px">${conflictList}</ul>${!usePrec ? '<p class="small muted">Tick “Use it to resolve LR conflicts” in the sidebar to apply the precedence declarations, the way yacc does.</p>' : ''}` : ''}
       ${resolved ? `<div class="sub">Resolved with precedence</div><ul class="steps" style="font-family:inherit;font-size:14px">${resolved}</ul>` : ''}
       ${kind !== 'lr0' ? `<div class="sub">Shift-reduce parse of <span class="raw">“${esc((tk.toks || []).join(' ') || EPS)}”</span> ${accepted === null ? '' : accepted ? okChip('accepted') : badChip('rejected')}</div><p class="small muted">Stack holds states and grammar symbols, top on the right. On reduce, the handle is popped and GOTO picks the new state.</p>${traceHTML}` : `<div class="btnRow">${psBtn('slr', 'Build the SLR(1) table')}</div>`}`);
  }

  function psOpPrec(G, prec) {
    const op = PS.operatorPrecedence(G, prec);
    if (!op.ok) return stage('ps-op', '', 'Operator precedence parser', badChip('not an operator grammar'), `<p>An operator grammar has no ${EPS}-productions and never two nonterminals side by side.</p><ul class="steps">${op.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`);
    const lt = G.nts.filter((A) => G.prods.some((p) => p.lhs === A)).map((A) => [`<b>${esc(A)}</b>`, psSet(op.LEAD.get(A)), psSet(op.TRAIL.get(A))]);
    const rows = op.terms.map((a) => [`<b>${esc(a)}</b>`, ...op.terms.map((b) => { const s = [...op.R.get(a).get(b)]; return { v: s.map((r) => PS.relSym[r]).join(' '), cls: s.length > 1 ? 'conflict' : '' }; })]);
    const tk = psTokens(G);
    let trace = `<p>${esc(tk.err || '')}</p>`, accepted = null;
    if (!tk.err) {
      const r = tk.toks.length ? PS.opPrecParse(op, tk.toks) : { rows: [], accepted: false };
      accepted = r.accepted;
      trace = traceTable(['Stack', 'Relation', 'Input', 'Action'], r.rows.map((x) => [esc(x.stack), esc(x.rel), inputCell(x.input), esc(x.action)]), r.accepted);
    }
    const chk = op.conflicts.length ? '' : PS.checkRecognizer(G, (w) => w.length > 0 && PS.opPrecParse(op, w).accepted);
    let meta = op.conflicts.length ? badChip(`${op.conflicts.length} cells with two relations`) : okChip('precedence relations are unique');
    if (chk) meta += chk.bad && !chk.bad.expected ? okChip(`accepts all ${chk.positives} strings of L(G) up to ${chk.maxLen} tokens`) : recogChip({ ...chk, negatives: 0 }, 'parser');
    return stage('ps-op', '', 'Operator precedence parser', meta,
      `<div class="formula">a ≐ b if they appear as a b or a B b · a ⋖ b for b ∈ LEADING(B) when a B appears · a ⋗ b for a ∈ TRAILING(A) when A b appears · $ ⋖ LEADING(${esc(G.start)}), TRAILING(${esc(G.start)}) ⋗ $</div>
       ${ui.table(['Nonterminal', 'LEADING', 'TRAILING'], lt, 'mono')}
       ${op.resolved.length ? `<p class="small">${op.resolved.length} ambiguous cells were settled with the precedence declarations (higher level ⋗, equal level: left-associative ⋗, right-associative ⋖).</p>` : ''}
       <div class="sub">Precedence relations (row ? column)</div>${grid(['', ...op.terms.map(esc)], rows)}
       <div class="sub">Parse of <span class="raw">“${esc((tk.toks || []).join(' ') || EPS)}”</span> ${accepted === null ? '' : accepted ? okChip('accepted') : badChip('rejected')}</div>
       <p class="small muted">Shift while top ⋖ or ≐ lookahead; on ⋗ pop the handle until the top terminal ⋖ the last popped one. Only terminals are kept, so this checks the operator structure, not every grammar detail.</p>
       ${trace}`);
  }

  function runPS(op) {
    lastPsOp = op || lastPsOp;
    $$('[data-ps]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ps === lastPsOp)));
    showErr($('#psErr'), '');
    if (blank('#psIn')) { store.set('ps', ''); emptyState($('#psOut'), 'Type a grammar', 'One production per line, such as E -> E + T | T. Then build FIRST and FOLLOW, LL(1), SLR, CLR or LALR tables and parse a string.', 'parse'); return; }
    let G, prec;
    try { G = PS.parseGrammar($('#psIn').value); } catch (e) { showErr($('#psErr'), e.message); return; }
    try { prec = PS.parsePrecedence($('#psPrec').value); } catch (e) { showErr($('#psErr'), e.message); return; }
    store.set('ps', $('#psIn').value); store.set('psw', $('#psW').value); store.set('psprec', $('#psPrec').value);
    const usePrec = $('#psUsePrec').checked;
    const lrec = PS.leftRecursive(G);
    let html = `<div class="summary">${chip('start', esc(G.start))}${chip('N', esc('{' + G.nts.join(', ') + '}'))}${chip('T', esc('{' + G.terms.join(', ') + '}'))}${chip('productions', G.prods.length)}${lrec.length ? `<span class="chip bad">left-recursive: ${esc(lrec.join(', '))}</span>` : ''}</div>`;
    html += (G.warnings || []).map((w) => `<p class="small muted">${esc(w)}</p>`).join('');
    try {
      const o = lastPsOp;
      if (o === 'ff') html += psFirstFollow(G);
      else if (o === 'lr') html += psLeftRec(G);
      else if (o === 'lf') html += psLeftFactor(G);
      else if (o === 'amb') html += psDisambiguate(G, prec);
      else if (o === 'cnf') html += psCNF(G);
      else if (o === 'll1') html += psLL1(G);
      else if (o === 'pp') html += psLL1(G).replace('id="ps-ll1"', 'id="ps-ll1b"') + psPredictive(G);
      else if (o === 'rd') html += psRecursive(G);
      else if (o === 'op') html += psOpPrec(G, prec);
      else html += psLR(G, o, prec, usePrec);
    } catch (e) { showErr($('#psErr'), e.message); return; }
    ui.put($('#psOut'), html);
  }
  rerenders.parse = () => runPS();
  $$('[data-ps]').forEach((b) => b.addEventListener('click', () => runPS(b.dataset.ps)));
  $('#psUsePrec').addEventListener('change', () => { if (['slr', 'clr', 'lalr'].includes(lastPsOp)) runPS(); });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-usegram]');
    if (g && grammars.has(g.dataset.usegram)) { $('#psIn').value = ui.D(PS.grammarText(grammars.get(g.dataset.usegram))); runPS('ff'); $('#tab-parse .board').scrollTop = 0; }
    const b = e.target.closest('[data-psgo]');
    if (b) runPS(b.dataset.psgo);
  });
  ['#psW'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') runPS(); }));

  // SIMPLIFICATION AND CNF (parsing tab)
  const TH = DT.theory;
  function psCNF(G) {
    const r = TH.simplifyCNF(G);
    const sameNoEps = (G1, G2, len = 6) => {
      const a = PS.enumerate(G1, len), b = PS.enumerate(G2, len);
      const A = new Set(a.list.map((x) => x.join(' ')).filter(Boolean)), B = new Set(b.list.map((x) => x.join(' ')));
      const diff = [...A].find((x) => !B.has(x)) ?? [...B].find((x) => !A.has(x));
      return { eq: diff === undefined, n: A.size, len, truncated: a.truncated || b.truncated, witness: diff };
    };
    const chk = sameNoEps(G, r.cnf.G);
    const cnfOk = TH.isCNF(r.cnf.G);
    const step = (n, title, text, g) => `<div><div class="sub">${n}. ${title}</div><p>${text}</p>${gramBlock(g)}</div>`;
    const lam = r.lambda.nullable.length
      ? `Nullable variables: <b class="mono">{${r.lambda.nullable.map(esc).join(', ')}}</b>. Every production gets a copy for each way of leaving nullable symbols out, and the ${EPS}-productions are dropped.${r.lambda.startNullable ? ` ${EPS} itself is in L(G), so the result generates L(G) − {${EPS}}.` : ''}`
      : `No variable can derive ${EPS}, so nothing changes.`;
    const unit = r.unit.pairs.length
      ? `Unit pairs (A ⇒* B through unit productions only): ${r.unit.pairs.map(([a, b]) => `(${esc(a)}, ${esc(b)})`).join(', ')}. Each A gets B's non-unit productions and the unit productions are dropped.`
      : 'There are no unit productions.';
    const use = r.useless.nonGen.length || r.useless.unreach.length
      ? `${r.useless.nonGen.length ? `Cannot derive a terminal string: ${r.useless.nonGen.map(esc).join(', ')}. ` : ''}${r.useless.unreach.length ? `Not reachable from ${esc(G.start)}: ${r.useless.unreach.map(esc).join(', ')}.` : ''}`
      : 'Every variable is generating and reachable.';
    const cnf = `Terminals inside longer right sides are replaced by new variables (${r.cnf.termVar.map(([a, B]) => `${esc(B)} → ${esc(a)}`).join(', ') || 'none needed'}), and right sides longer than two are broken into a chain${r.cnf.chain.length ? ` (${r.cnf.chain.map(esc).join(', ')})` : ''}.`;
    return stage('ps-cnf', '', 'Simplify the grammar and convert to Chomsky normal form',
      (cnfOk ? okChip('in CNF: every rule is A → BC or A → a') : badChip('not in CNF')) + (chk.eq ? okChip(`same strings as the original (except ${EPS}), all ${chk.n} up to ${chk.len} tokens${chk.truncated ? ' (sampled)' : ''}`) : badChip(`differs on "${chk.witness || EPS}"`)),
      `<div class="formula">Order: remove ${EPS}-productions → remove unit productions → remove useless symbols → Chomsky normal form</div>
       ${step(1, `Remove ${EPS}-productions`, lam, r.lambda.G)}
       ${step(2, 'Remove unit productions', unit, r.unit.G)}
       ${step(3, 'Remove useless symbols', use, r.useless.G)}
       ${r.useless.empty ? `<p><b>${esc(G.start)} cannot derive any terminal string, so L(G) is empty.</b></p>` : step(4, 'Chomsky normal form', cnf, r.cnf.G)}
       <div class="btnRow">${useBtn(r.cnf.G, 'Use the CNF grammar')}</div>`);
  }

  App.export({ PS: () => PS, okChip: () => okChip, badChip: () => badChip, gramBlock: () => gramBlock, grid: () => grid, traceTable: () => traceTable, inputCell: () => inputCell, runPS: () => runPS, TH: () => TH });
})(window.DT);
