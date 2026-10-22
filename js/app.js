/* Page wiring: mode tabs, the five tools and the step-by-step result views. */
(function (DT) {
  'use strict';
  const { ui, fa: FA, regex: RX, grammar: GR, EPS } = DT;
  const { esc, $, $$ } = ui;
  const store = {
    get(k) { try { return localStorage.getItem('dt-' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('dt-' + k, v); } catch (e) { /* ignore */ } }
  };
  const showErr = (el, msg) => { el.textContent = msg ? ui.D(msg) : ''; el.hidden = !msg; };
  const loadables = new Map();
  let loadId = 0;
  const loadBtn = (fa, text = 'Open in Draw FA') => { const id = 'L' + ++loadId; loadables.set(id, fa); return `<button type="button" class="ghost" data-load="${id}">${text}</button>`; };
  ui.showDead = store.get('dead') === '1';
  const rerenders = {};

  // tabs
  const TABS = ['re', 'fa', 'lang', 'rg', 'cfg', 'parse'];
  function showTab(t, push = true) {
    if (!TABS.includes(t)) t = 're';
    $$('.modes [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    TABS.forEach((x) => ($('#tab-' + x).hidden = x !== t));
    if (push) { try { history.replaceState(null, '', '#' + t); } catch (e) { /* ignore */ } }
    if (t === 'fa') { editor.redraw(); if (!fittedOnce) { fittedOnce = true; editor.fit(); } }
  }
  let fittedOnce = false;
  $$('.modes [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { e.preventDefault(); showTab(g.dataset.goto); window.scrollTo(0, 0); }
    const l = e.target.closest('[data-load]');
    if (l && loadables.has(l.dataset.load)) {
      showTab('fa'); window.scrollTo(0, 0);
      const renamed = editor.load(loadables.get(l.dataset.load));
      closeDrawer();
      toast(renamed ? 'Loaded. States were renamed q0, q1, … to keep them short.' : 'Loaded into the canvas.');
    }
  });

  /* empty-string symbol switch */
  function setEps(v) {
    ui.eps = v; store.set('eps', v);
    $$('[data-eps]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.eps === v)));
    $$('[data-ins="λ"]').forEach((b) => (b.textContent = v));
    Object.values(rerenders).forEach((f) => f && f());
    editor.redraw();
  }
  $$('[data-eps]').forEach((b) => b.addEventListener('click', () => setEps(b.dataset.eps)));

  /* light / dark */
  const isDark = () => {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  function syncThemeIcon() { $('#themeBtn use').setAttribute('href', isDark() ? '#i-sun' : '#i-moon'); }
  $('#themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
    syncThemeIcon();
  });
  syncThemeIcon();

  /* key pads and example chips */
  $$('.keys').forEach((k) => k.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ins]'); if (!b) return;
    const inp = document.getElementById(k.dataset.target);
    const ch = b.dataset.ins === 'λ' ? ui.eps : b.dataset.ins;
    const s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? inp.value.length;
    inp.value = inp.value.slice(0, s) + ch + inp.value.slice(en);
    inp.focus(); inp.setSelectionRange(s + ch.length, s + ch.length);
  }));
  $$('.examples').forEach((x) => x.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const inp = document.getElementById(x.dataset.for);
    inp.value = ui.D(b.dataset.v || b.textContent);
    if (x.dataset.for === 'reIn') runRE();
    if (x.dataset.for === 'rgIn') runRG();
    if (x.dataset.for === 'cfgIn') runCFG(lastCfgOp);
    if (x.dataset.for === 'psIn') runPS();
  }));

  // shared result pieces
  const stage = (id, num, title, meta, body) =>
    `<section class="stage" id="${id}"><div class="stage-h">${num ? `<span class="num">${num}</span>` : ''}<h2>${title}</h2><div class="meta">${meta || ''}</div></div>${body}</section>`;
  const chip = (k, v) => `<span class="chip">${k} <b>${v}</b></span>`;
  const verifyChip = (r, what = 'same language as input') =>
    r.eq ? `<span class="chip ok" title="Checked by comparing the two automata state by state">✓ ${what}</span>` : `<span class="chip bad">✗ differs on "${esc(r.witness || EPS)}"</span>`;
  const deadToggle = () => `<label class="chk small"><input type="checkbox" class="deadToggle" ${ui.showDead ? 'checked' : ''}> show trap state</label>`;
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('deadToggle')) {
      ui.showDead = e.target.checked; store.set('dead', ui.showDead ? '1' : '0');
      Object.values(rerenders).forEach((f) => f && f());
    }
  });
  const hideFor = (fa) => (ui.showDead ? new Set() : FA.deadStates(fa));
  const setOf = (labels, arr) => (arr.length ? '{' + arr.map((i) => esc(labels[i])).join(',') + '}' : '<span class="none">∅</span>');
  const sigmaStr = (A) => '{' + A.join(', ') + '}';

  function thompsonHTML(t) {
    const rule = { sym: 'symbol', eps: 'λ', empty: '∅', cat: 'concatenation', or: 'union', star: 'star' };
    const rows = t.parts.map((p, i) => [i + 1, `<span class="mono">${esc(p.re)}</span>`, rule[p.kind], `q${p.s}`, `q${p.f}`]);
    return `<details><summary>Construction order (Thompson)</summary><p class="small muted">Each sub-expression gets its own start and final state, built from the inside out. Concatenation joins pieces with a λ-move, union and star add a new start and final state with λ-moves.</p>${ui.table(['#', 'sub-expression', 'rule', 'start', 'final'], rows)}</details>`;
  }

  function removeEpsHTML(src, r, id = 'st-nfa', num = '2') {
    const L = src.labels;
    const rows = r.rows.map((row) => ({
      cls: row.reachable ? '' : 'dim',
      cells: [`${row.q === src.start ? '<span class="mk-start">→</span>' : ''}${row.final ? '<span class="mk-final">*</span>' : ''}${esc(L[row.q])}`, setOf(L, row.closure), ...r.alphabet.map((a) => setOf(L, row.next[a]))]
    }));
    const eq = FA.equivalent(src, r.fa);
    const body = `<div class="formula">δ'(q, a) = λ-closure( δ( λ-closure(q), a ) )  ·  q is final if λ-closure(q) contains a final state</div>
      ${ui.table(['state', 'λ-closure', ...r.alphabet.map((a) => `δ'(q, ${esc(a)})`)], rows, 'mono')}
      ${r.removed ? `<p class="small muted">${r.removed} state(s) crossed out are unreachable without λ-moves and are dropped from the diagram.</p>` : ''}
      ${r.fa.n > 8 ? `<details><summary>Show diagram (${r.fa.n} states, many arrows)</summary>${ui.slot(ui.faGraph(r.fa))}${ui.legend}</details>` : ui.slot(ui.faGraph(r.fa)) + ui.legend}`;
    return stage(id, num, 'λ-NFA → NFA without λ-moves', chip('states', r.fa.n) + verifyChip(eq), body);
  }

  function subsetHTML(src, sb, id = 'st-dfa', num = '3') {
    const L = src.labels, dfa = sb.fa;
    const T = new Map(dfa.trans.map((t) => [t.from + '|' + t.sym, t.to]));
    const rows = sb.sets.map((S, i) => [ui.stateCell(dfa, i), setOf(L, S), ...sb.alphabet.map((a) => esc(dfa.labels[T.get(i + '|' + a)]))]);
    const eq = FA.equivalent(src, dfa);
    const hasDead = dfa.labels.includes('∅');
    const first = sb.sets[0];
    const body = `<div class="formula">Start: A = λ-closure(${esc(L[src.start])}) = ${setOf(L, first).replace(/<[^>]+>/g, '')}  ·  Next: λ-closure( move(S, a) )  ·  final if S contains a final state</div>
      ${ui.table(['DFA state', 'set of NFA states', ...sb.alphabet.map(esc)], rows, 'mono')}
      ${hasDead ? '<p class="small muted">∅ is the trap (dead) state: once there, the string can never be accepted.</p>' : ''}
      ${ui.slot(ui.faGraph(dfa, { hide: hideFor(dfa) }))}${ui.legend}`;
    return stage(id, num, 'NFA → DFA (subset construction)', chip('states', dfa.n) + verifyChip(eq) + deadToggle(), body);
  }

  function minimizeHTML(src, m, id = 'st-min', num = '4') {
    const L = m.labels, n = m.dfa.n, A = m.alphabet;
    let mark = '';
    if (n > 1) {
      const head = ['', ...L.slice(0, n - 1).map(esc)];
      const rows = [];
      for (let i = 1; i < n; i++) {
        const cells = [`<b>${esc(L[i])}</b>`];
        for (let j = 0; j < n - 1; j++) {
          if (j >= i) cells.push('');
          else { const mk = m.mark[i][j]; cells.push(mk ? `×<sub>${mk.pass}</sub>` : '='); }
        }
        rows.push(cells);
      }
      mark = ui.table(head, rows, 'mark mono').replace(/<td>×/g, '<td class="x">×').replace(/<td>=<\/td>/g, '<td class="eq">=</td>').replace(/<td><\/td>/g, '<td class="blank"></td>');
    }
    const pair = (i, j) => `(${esc(L[i])},${esc(L[j])})`;
    const passList = m.passes.map((p, k) => k === 0
      ? `<li><b>Pass 0</b>: mark every (final, non-final) pair: ${p.length ? p.map((x) => pair(x.i, x.j)).join(' ') : 'none'}</li>`
      : `<li><b>Pass ${k}</b>: ${p.map((x) => `${pair(x.i, x.j)} on ${esc(x.a)} → ${pair(x.to[0], x.to[1])}`).join(', ')}</li>`).join('') +
      `<li><b>Pass ${m.passes.length}</b>: nothing new is marked, stop. Unmarked pairs (=) are indistinguishable.</li>`;
    const partList = m.partitions.map((p, k) => `<div>π<sub>${k}</sub> = ${p.map((g) => `<span class="grp">{${g.map((q) => esc(L[q])).join(',')}}</span>`).join('')}</div>`).join('') +
      `<div class="muted">π<sub>${m.partitions.length}</sub> = π<sub>${m.partitions.length - 1}</sub>, so stop.</div>`;
    const merged = m.groups.filter((g) => g.length > 1);
    const eq = FA.equivalent(src, m.min);
    const body = `${m.notes.length ? `<ul class="steps">${m.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p>${merged.length ? `Merged: ${merged.map((g) => `<b class="mono">{${g.map((q) => esc(L[q])).join(',')}}</b>`).join(', ')}.` : 'No two states are equivalent, so the DFA is already minimal.'}</p>
      <div class="cols">
        <div><div class="sub">Mark procedure (table filling)</div>${mark || '<p class="small muted">Only one state.</p>'}<ol class="steps" start="0">${passList}</ol></div>
        <div><div class="sub">Equivalence (π) method</div><div class="part">${partList}</div></div>
      </div>
      <div class="cols">
        <div><div class="sub">Minimal DFA table</div>${ui.faTable(m.min)}${ui.legend}</div>
        <div><div class="sub">Diagram</div>${ui.slot(ui.faGraph(m.min, { hide: hideFor(m.min) }))}</div>
      </div>`;
    return stage(id, num, 'Minimize the DFA', chip('states', m.min.n) + verifyChip(eq) + deadToggle(), body);
  }

  function regexHTML(src, res, id = 'st-re', num = '') {
    const N = res.names;
    const eq = FA.equivalent(src, FA.thompson(RX.parse(res.regex)).fa);
    const snapG = (snap) => ({
      nodes: snap.nodes.map((i) => ({ id: i, label: N[i], start: i === res.S, final: i === res.F })),
      edges: snap.edges
    });
    const order = res.steps.slice(1).map((s) => N[s.q]).join(', ');
    let steps = '';
    res.steps.slice(1).forEach((s, k) => {
      const lines = s.lines.map((l) => `<li>${esc(N[l.p])} → ${esc(N[l.r])}: &nbsp;${l.old ? `(${esc(l.old)}) + ` : ''}(${esc(l.pq)})${l.qq ? `(${esc(l.qq)})*` : ''}(${esc(l.qr)}) &nbsp;=&nbsp; <b>${esc(l.res)}</b></li>`).join('');
      steps += `<div><div class="sub">Step ${k + 1}: remove ${esc(N[s.q])}${s.loop ? ` (self-loop ${esc(s.loop)})` : ''}</div>
        ${lines ? `<ul class="steps">${lines}</ul>` : '<p class="small muted">No path passes through this state, so it is simply removed.</p>'}
        ${ui.slot(snapG(s.snap))}</div>`;
    });
    const body = `<div class="answer">${esc(res.regex)}</div>
      <div class="btnRow"><button type="button" class="ghost" data-copy="${esc(res.regex)}">Copy RE</button><button type="button" class="ghost" data-re="${esc(res.regex)}">Open this RE in RE → FA</button></div>
      <p class="small muted">Method: generalized transition graph (state elimination). A new start ${esc(N[res.S])} and a single final ${esc(N[res.F])} are added with λ-edges. Removing a state q replaces every path p → q → r by r(p,r) + r(p,q) r(q,q)* r(q,r). Elimination order used: ${esc(order || 'none')}.${res.removed && res.removed.length ? ` Unreachable or dead states dropped first: ${esc(res.removed.join(', '))}.` : ''}</p>
      <div class="formula">r(p,r) ← r(p,r) + r(p,q) · r(q,q)* · r(q,r)</div>
      <details open><summary>Elimination steps</summary>
        <div><div class="sub">Initial GTG</div>${ui.slot(snapG(res.steps[0].snap))}</div>
        ${steps}
      </details>`;
    return stage(id, num, 'FA → Regular expression', verifyChip(eq), body);
  }

  const prodsHTML = (prods) => `<div class="prods">${prods.map((p) => `<span class="v">${esc(p.lhs)}</span> → ${p.rhs.map(esc).join(' | ')}`).join('\n')}</div>`;
  const prodsText = (prods) => prods.map((p) => `${p.lhs} -> ${p.rhs.join(' | ')}`).join('\n');
  function grammarCheck(src, prods) {
    try { return FA.equivalent(src, GR.regularToNFA(GR.parse(prodsText(prods))).fa); } catch (e) { return { eq: false, witness: '?' }; }
  }
  function rlgHTML(src) {
    const r = FA.toRightLinear(src);
    const map = r.vars.map((v, i) => `${esc(r.fa.labels[i])} = ${v}`).join(', ');
    const body = `<p class="small muted">Rule: every move δ(qi, a) = qj gives qi → a qj, a λ-move gives qi → qj, and every final state gets qi → λ. States renamed: ${map}.</p>
      ${prodsHTML(r.prods)}
      <div class="btnRow"><button type="button" class="ghost" data-copy="${esc(ui.D(prodsText(r.prods)))}">Copy grammar</button></div>`;
    return stage('st-rlg', '', 'FA → Right-linear grammar', verifyChip(grammarCheck(src, r.prods), 'generates the same language'), body);
  }
  function llgHTML(src) {
    const r = FA.toLeftLinear(src);
    const body = `<ol class="steps">
        <li>Reverse the FA: the start state becomes final, final states become the start, arrows flip.${r.reversed.note ? ' ' + esc(r.reversed.note) : ''}</li>
        <li>Write the right-linear grammar of the reversed FA.</li>
        <li>Reverse the right side of every production. The result is left-linear.</li></ol>
      <div class="cols">
        <div><div class="sub">1. Reversed FA M'</div>${ui.slot(ui.faGraph(r.reversed.fa))}</div>
        <div><div class="sub">2. Right-linear grammar of M'</div>${prodsHTML(r.right.prods)}</div>
      </div>
      <div class="sub">3. Left-linear grammar</div>${prodsHTML(r.prods)}
      <div class="btnRow"><button type="button" class="ghost" data-copy="${esc(ui.D(prodsText(r.prods)))}">Copy grammar</button></div>`;
    return stage('st-llg', '', 'FA → Left-linear grammar', verifyChip(grammarCheck(src, r.prods), 'generates the same language'), body);
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      const txt = c.dataset.copy;
      const done = () => { const o = c.textContent; c.textContent = 'Copied'; setTimeout(() => (c.textContent = o), 1200); };
      try { navigator.clipboard.writeText(ui.D(txt)).then(done, () => (c.textContent = ui.D(txt))); } catch (err) { c.textContent = ui.D(txt); }
    }
    const r = e.target.closest('[data-re]');
    if (r) { $('#reIn').value = ui.D(r.dataset.re); showTab('re'); runRE(); window.scrollTo(0, 0); }
  });

  function testRows(fa, list) {
    const dfa = FA.isDFA(fa) ? fa : null;
    const A = FA.alphabetOf(fa);
    return list.map((w0) => {
      const w = DT.isEps(w0) ? '' : w0;
      const bad = [...w].find((c) => !A.includes(c));
      const r = FA.accepts(fa, w);
      let run;
      if (dfa) {
        const T = new Map(fa.trans.map((t) => [t.from + '|' + t.sym, t.to]));
        let s = fa.start; const parts = [esc(fa.labels[s])];
        for (const c of w) { s = T.get(s + '|' + c); if (s === undefined) { parts.push(`→${esc(c)} (no move)`); break; } parts.push(`→${esc(c)} ${esc(fa.labels[s])}`); }
        run = parts.join(' ');
      } else run = r.trace.map((S) => setOf(fa.labels, S)).join(' → ');
      return [`<b>${esc(w || EPS)}</b>`, r.ok ? '<span class="chip ok">accepted</span>' : `<span class="chip bad">rejected</span>${bad ? ` <span class="small muted">("${esc(bad)}" not in Σ)</span>` : ''}`, run];
    });
  }
  const splitList = (s) => s.split(/[,\s]+/).filter((x) => x.length);

  // RE → FA
  let reState = null;
  function runRE() {
    const src = $('#reIn').value;
    showErr($('#reErr'), '');
    let ast;
    try { ast = RX.parse(src); } catch (e) { showErr($('#reErr'), e.message); return; }
    store.set('re', src);
    const t = FA.thompson(ast);
    const ef = FA.removeEps(t.fa);
    const sb = FA.subset(t.fa);
    const mn = FA.minimize(sb.fa);
    reState = { src, ast, t, ef, sb, mn };
    renderRE();
  }
  function renderRE() {
    if (!reState) return;
    const { ast, t, ef, sb, mn } = reState;
    const A = FA.alphabetOf(t.fa);
    let html = `<div class="summary">${chip('RE', esc(RX.astStr(ast)))}${chip('Σ', esc(sigmaStr(A)))}${chip('λ-NFA', t.fa.n)}${chip('NFA', ef.fa.n)}${chip('DFA', sb.fa.n)}${chip('min DFA', mn.min.n)}</div>
      <nav class="jump"><a href="#st-enfa">1 · λ-NFA</a><a href="#st-nfa">2 · NFA</a><a href="#st-dfa">3 · DFA</a><a href="#st-min">4 · Minimal DFA</a><a href="#st-test">Test strings</a></nav>`;
    html += stage('st-enfa', '1', 'RE → λ-NFA', chip('states', t.fa.n),
      `${ui.slot(ui.faGraph(t.fa))}${ui.legend}<div class="sub">Transition table</div>${ui.faTable(t.fa, { eps: true })}${thompsonHTML(t)}`);
    html += removeEpsHTML(t.fa, ef);
    html += subsetHTML(t.fa, sb);
    html += minimizeHTML(t.fa, mn);
    html += stage('st-test', '', 'Test strings on the minimal DFA', '',
      `<form class="row wrapRow" id="reTestForm"><label class="sr" for="reTest">Strings</label><input id="reTest" class="mono" value="${esc(store.get('retest') || 'abb, aabb, ab, ' + ui.eps)}"><button class="ghost" type="submit">Run</button></form><div id="reTestOut"></div>
       <div class="btnRow">${loadBtn(mn.min, 'Open minimal DFA in Draw FA')}${loadBtn(t.fa, 'Open λ-NFA in Draw FA')}${loadBtn(sb.fa, 'Open DFA in Draw FA')}</div>`);
    ui.put($('#reOut'), html);
    $('#reTestForm').addEventListener('submit', (e) => { e.preventDefault(); runReTest(); });
    runReTest();
  }
  function runReTest() {
    const v = $('#reTest').value; store.set('retest', v);
    ui.put($('#reTestOut'), ui.table(['string', 'result', 'run'], testRows(reState.mn.min, splitList(v)), 'mono'));
  }
  rerenders.re = renderRE;
  $('#reForm').addEventListener('submit', (e) => { e.preventDefault(); runRE(); });

  // DRAW FA
  const editor = DT.Editor($('#editor'), { isActive: () => !$('#tab-fa').hidden });
  const EX = {
    even: { n: 2, start: 0, finals: [0], labels: ['q0', 'q1'], t: [[0, 'b', 0], [0, 'a', 1], [1, 'b', 1], [1, 'a', 0]] },
    endsab: { n: 3, start: 0, finals: [2], labels: ['q0', 'q1', 'q2'], t: [[0, 'a', 0], [0, 'b', 0], [0, 'a', 1], [1, 'b', 2]] },
    contains01: { n: 3, start: 0, finals: [2], labels: ['q0', 'q1', 'q2'], t: [[0, '1', 0], [0, '0', 1], [1, '0', 1], [1, '1', 2], [2, '0', 2], [2, '1', 2]] },
    lnfa: { n: 2, start: 0, finals: [1], labels: ['q0', 'q1'], t: [[0, 'a', 0], [0, EPS, 1], [1, 'b', 1]] },
    minme: { n: 5, start: 0, finals: [4], labels: ['q0', 'q1', 'q2', 'q3', 'q4'], t: [[0, 'a', 1], [0, 'b', 2], [1, 'a', 1], [1, 'b', 3], [2, 'a', 1], [2, 'b', 2], [3, 'a', 1], [3, 'b', 4], [4, 'a', 1], [4, 'b', 2]] }
  };
  const exFA = (e) => ({ n: e.n, start: e.start, finals: new Set(e.finals), labels: e.labels, trans: e.t.map(([f, s, t]) => ({ from: f, sym: s, to: t })) });

  let toastTimer = null;
  function toast(msg) {
    const t = $('#faErr');
    t.textContent = ui.D(msg); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  const OP_TITLES = { eps: 'Remove λ-moves', dfa: 'NFA → DFA', min: 'Minimize DFA', re: 'FA → regular expression', rlg: 'Right-linear grammar', llg: 'Left-linear grammar', test: 'Test strings' };
  function openDrawer(title) { const wasHidden = $('#drawer').hidden; $('#drawer').hidden = false; if (wasHidden) requestAnimationFrame(() => editor.fit()); $('#drawerTitle').textContent = ui.D(title); $('#drawerBtn').setAttribute('aria-pressed', 'true'); editor.redraw(); }
  function closeDrawer() { $('#drawer').hidden = true; $('#drawerBtn').setAttribute('aria-pressed', 'false'); $$('.op[data-op]').forEach((b) => b.setAttribute('aria-pressed', 'false')); editor.redraw(); }
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBtn').addEventListener('click', () => { if ($('#drawer').hidden) { if (lastOp) runOp(lastOp); else openDrawer('Results'); } else closeDrawer(); });

  $('#faExample').addEventListener('change', (e) => { if (EX[e.target.value]) { editor.load(exFA(EX[e.target.value]), { rename: false }); closeDrawer(); } e.target.value = ''; });
  $('#tidyBtn').addEventListener('click', () => { try { editor.tidy(); } catch (err) { toast(err.message); } });
  const menu = $('#exportMenu'), menuBtn = $('#exportBtn');
  const setMenu = (open) => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menuWrap')) setMenu(false); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (b) { setMenu(false); try { editor.exportAs(b.dataset.export); } catch (err) { toast(err.message); } }
  });
  $('#faClear').addEventListener('click', () => { setMenu(false); editor.clear(); closeDrawer(); toast('Canvas cleared. Ctrl+Z brings it back.'); });
  $('#importJson').addEventListener('change', (e) => {
    const f = e.target.files[0]; setMenu(false);
    if (!f) return;
    if (f.size > 1_000_000) { toast('Could not open that file: it is larger than 1 MB.'); e.target.value = ''; return; }
    f.text().then((txt) => { try { editor.importJSON(txt); closeDrawer(); } catch (err) { toast('Could not open that file: ' + err.message); } });
    e.target.value = '';
  });
  try { const saved = store.get('editor'); if (saved && (JSON.parse(saved).states || JSON.parse(saved).s || []).length) editor.restore(saved); else editor.load(exFA(EX.minme), { rename: false }); }
  catch (e) { editor.load(exFA(EX.minme), { rename: false }); }

  let lastOp = null;
  const elimOrder = () => store.get('elim') || '';
  const testList = () => store.get('fatest') || 'ab, aab, ba, λ';
  function runOp(op) {
    lastOp = op;
    $$('.op[data-op]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.op === op)));
    let src;
    try { src = editor.toFA(); } catch (e) { toast(e.message); return; }
    let html = '';
    try {
      if (op === 'eps') {
        if (!FA.hasEps(src)) html = '<p class="muted">This automaton has no λ-moves, so there is nothing to remove.</p>';
        else { const r = FA.removeEps(src); html = removeEpsHTML(src, r, 'st-nfa', '') + `<div class="btnRow">${loadBtn(r.fa, 'Load into canvas')}</div>`; }
      } else if (op === 'dfa') {
        const sb = FA.subset(src);
        html = (FA.isDFA(src) ? '<p class="small muted">Already deterministic. The table still shows the subset view; missing moves go to ∅.</p>' : '') + subsetHTML(src, sb, 'st-dfa', '') + `<div class="btnRow">${loadBtn(sb.fa, 'Load DFA into canvas')}</div>`;
      } else if (op === 'min') {
        const m = FA.minimize(src);
        html = minimizeHTML(src, m, 'st-min', '') + `<div class="btnRow">${loadBtn(m.min, 'Load minimal DFA into canvas')}</div>`;
      } else if (op === 're') {
        const order = splitList(elimOrder());
        html = `<form class="drawerForm" id="elimForm"><div class="field"><label class="lbl" for="elimOrder">Elimination order (optional)</label><input id="elimOrder" class="mono" placeholder="shortest result, or e.g. q1, q2" value="${esc(elimOrder())}" autocomplete="off"></div><button class="ghost" type="submit">Apply</button></form>` +
          regexHTML(src, FA.toRegex(src, order.length ? order : null));
      } else if (op === 'rlg') html = rlgHTML(src);
      else if (op === 'llg') html = llgHTML(src);
      else if (op === 'test') {
        html = `<form class="drawerForm" id="faTestForm"><div class="field"><label class="lbl" for="faTest">Strings, comma separated</label><input id="faTest" class="mono" value="${esc(ui.D(testList()))}" autocomplete="off"></div><button class="primary" type="submit">Run</button></form>` +
          ui.table(['string', 'result', FA.isDFA(src) ? 'run' : 'states after each symbol'], testRows(src, splitList(testList())), 'mono');
      }
    } catch (e) { toast(e.message); return; }
    openDrawer(OP_TITLES[op]);
    ui.put($('#faOut'), html);
  }
  $$('.op[data-op]').forEach((b) => b.addEventListener('click', () => runOp(b.dataset.op)));
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'elimForm') { e.preventDefault(); store.set('elim', $('#elimOrder').value); runOp('re'); }
    if (e.target.id === 'faTestForm') { e.preventDefault(); store.set('fatest', $('#faTest').value); runOp('test'); }
  });
  rerenders.fa = () => { if (lastOp && !$('#drawer').hidden) runOp(lastOp); };
  editor.onChange(() => { if (lastOp && !$('#drawer').hidden) runOp(lastOp); });

  // LANGUAGE → DFA
  const CONDS = [
    ['starts', 'starts with', ['w']], ['ends', 'ends with', ['w']], ['contains', 'contains substring', ['w']],
    ['countmod', 'number of x ≡ r (mod m)', ['x', 'm', 'r']], ['lenmod', 'length ≡ r (mod m)', ['m', 'r']],
    ['countcmp', 'number of x is (=, ≥, ≤) k', ['x', 'cmp', 'k']], ['lencmp', 'length is (=, ≥, ≤) k', ['cmp', 'k']],
    ['nthright', 'k-th symbol from the right is x', ['k', 'x']]
  ];
  function condUI(el, n, def) {
    el.innerHTML = `<span class="lbl">Condition ${n}</span>
      <label class="chk small"><input type="checkbox" class="cNot"> NOT</label>
      <label class="sr" for="cType${n}">Type</label><select class="cType" id="cType${n}">${CONDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <label class="small muted cf" data-f="w">w <input class="cW mono" value="${def.w || 'ab'}"></label>
      <label class="small muted cf" data-f="x">x <input class="cX mono" value="${def.x || 'b'}" maxlength="1"></label>
      <label class="small muted cf" data-f="cmp"><select class="cCmp"><option value="eq">=</option><option value="ge">≥</option><option value="le">≤</option></select></label>
      <label class="small muted cf" data-f="k">k <input class="cK mono" type="number" min="0" max="12" value="${def.k || 2}"></label>
      <label class="small muted cf" data-f="m">m <input class="cM mono" type="number" min="1" max="12" value="${def.m || 2}"></label>
      <label class="small muted cf" data-f="r">r <input class="cR mono" type="number" min="0" max="11" value="${def.r || 0}"></label>`;
    const sel = el.querySelector('.cType');
    sel.value = def.type;
    const sync = () => { const f = CONDS.find((c) => c[0] === sel.value)[2]; el.querySelectorAll('.cf').forEach((x) => (x.hidden = !f.includes(x.dataset.f))); };
    sel.addEventListener('change', sync); sync();
    return () => {
      const type = sel.value;
      const k = +el.querySelector('.cK').value;
      return {
        type, not: el.querySelector('.cNot').checked, w: el.querySelector('.cW').value.trim(), x: el.querySelector('.cX').value.trim(),
        m: type === 'countcmp' || type === 'lencmp' || type === 'nthright' ? k : +el.querySelector('.cM').value, r: +el.querySelector('.cR').value, cmp: el.querySelector('.cCmp').value
      };
    };
  }
  const getC1 = condUI($('#cond1'), 1, { type: 'starts', w: 'ab' });
  const getC2 = condUI($('#cond2'), 2, { type: 'countmod', x: 'b', m: 2, r: 0 });
  $('#langOp').addEventListener('change', (e) => ($('#cond2').hidden = !e.target.value));
  const condText = (c) => {
    const cmp = { eq: '=', ge: '≥', le: '≤' }[c.cmp];
    const t = {
      starts: `starts with ${c.w}`, ends: `ends with ${c.w}`, contains: `contains ${c.w}`, countmod: `#${c.x}(w) ≡ ${c.r} (mod ${c.m})`, lenmod: `|w| ≡ ${c.r} (mod ${c.m})`,
      countcmp: `#${c.x}(w) ${cmp} ${c.m}`, lencmp: `|w| ${cmp} ${c.m}`, nthright: `${c.m}-th symbol from the right is ${c.x}`
    }[c.type];
    return (c.not ? 'NOT ' : '') + t;
  };
  const condPred = (c) => {
    const f = {
      starts: (s) => s.startsWith(c.w), ends: (s) => s.endsWith(c.w), contains: (s) => s.includes(c.w),
      countmod: (s) => ([...s].filter((x) => x === c.x).length % c.m) === ((c.r % c.m) + c.m) % c.m, lenmod: (s) => s.length % c.m === ((c.r % c.m) + c.m) % c.m,
      countcmp: (s) => { const k = [...s].filter((x) => x === c.x).length; return c.cmp === 'eq' ? k === c.m : c.cmp === 'ge' ? k >= c.m : k <= c.m; },
      lencmp: (s) => (c.cmp === 'eq' ? s.length === c.m : c.cmp === 'ge' ? s.length >= c.m : s.length <= c.m),
      nthright: (s) => s.length >= c.m && s[s.length - c.m] === c.x
    }[c.type];
    return c.not ? (s) => !f(s) : f;
  };
  let langState = null;
  function runLang() {
    showErr($('#langErr'), '');
    try {
      const A = [...new Set($('#langSigma').value.split(/[\s,{}]+/).filter(Boolean))];
      if (!A.length || A.some((a) => !/^[a-zA-Z0-9]$/.test(a))) throw new Error('Σ must be single letters or digits separated by commas, like a,b');
      A.sort();
      const op = $('#langOp').value;
      const cs = [getC1(), ...(op ? [getC2()] : [])];
      const parts = cs.map((c) => {
        if (['starts', 'ends', 'contains'].includes(c.type) && !c.w) throw new Error('Type the string w.');
        let d = FA.buildCondition(c, A);
        let comp = null;
        if (c.not) { comp = FA.complementDFA(d, A); }
        return { c, d, comp };
      });
      const use = parts.map((p) => p.comp || p.d);
      const prod = op ? FA.product(use[0], use[1], op, A) : null;
      const target = prod || use[0];
      const m = FA.minimize(target);
      // brute-force check against the description for all strings up to a length
      const preds = cs.map(condPred);
      const pred = (s) => (op === 'and' ? preds[0](s) && preds[1](s) : op === 'or' ? preds[0](s) || preds[1](s) : preds[0](s));
      let maxL = 0, total = 1; while (maxL < 10 && total * A.length < 30000) { total *= A.length; maxL++; }
      let bad = null;
      const T = new Map(m.min.trans.map((t) => [t.from + '|' + t.sym, t.to]));
      const run = (s) => { let q = m.min.start; for (const ch of s) q = T.get(q + '|' + ch); return m.min.finals.has(q); };
      const gen = (s) => { if (bad !== null) return; if (run(s) !== pred(s)) { bad = s; return; } if (s.length < maxL) for (const a of A) gen(s + a); };
      gen('');
      langState = { A, op, parts, prod, m, maxL, bad };
      renderLang();
    } catch (e) { showErr($('#langErr'), e.message); }
  }
  function renderLang() {
    if (!langState) return;
    const { A, op, parts, prod, m, maxL, bad } = langState;
    const desc = parts.map((p) => condText(p.c)).join(op === 'and' ? ' AND ' : ' OR ');
    let html = `<div class="summary">${chip('L', esc(`{ w ∈ ${sigmaStr(A)}* : ${desc} }`))}${bad === null ? `<span class="chip ok">✓ checked on every string up to length ${maxL}</span>` : `<span class="chip bad">✗ mismatch on "${esc(bad)}"</span>`}</div>`;
    parts.forEach((p, i) => {
      const base = { ...p.c, not: false };
      html += stage('lc' + i, String(i + 1), `DFA for: ${esc(condText(base))}`, chip('states', p.d.n), `${p.c.type === 'nthright' ? '<p class="small muted">Built as the NFA Σ* x Σ<sup>k−1</sup>, then converted with subset construction. That is why it needs 2<sup>k</sup> states.</p>' : ''}${ui.slot(ui.faGraph(p.d, { hide: hideFor(p.d) }))}${ui.faTable(p.d)}`);
      if (p.comp) html += stage('lcn' + i, '', `Complement: ${esc(condText(p.c))}`, '', `<p class="small muted">Complete the DFA (add a trap state if needed), then swap final and non-final states.</p>${ui.slot(ui.faGraph(p.comp))}`);
    });
    if (prod) html += stage('lprod', '', `Product construction (${op.toUpperCase()})`, chip('states', prod.n), `<p class="small muted">States are pairs (p, q) of the two DFAs, moving on both at once. A pair is final when ${op === 'and' ? 'both' : 'at least one'} of p and q is final.</p>${ui.slot(ui.faGraph(prod, { hide: hideFor(prod) }))}`);
    html += minimizeHTML(prod || parts[0].comp || parts[0].d, m, 'lmin', '');
    html += regexHTML(m.min, FA.toRegex(m.min), 'lre', '');
    html += `<div class="btnRow">${loadBtn(m.min, 'Open minimal DFA in Draw FA')}</div>`;
    ui.put($('#langOut'), html);
  }
  rerenders.lang = renderLang;
  $('#langGo').addEventListener('click', runLang);

  // GRAMMAR ⇄ FA
  let rgState = null;
  function runRG() {
    showErr($('#rgErr'), '');
    try {
      const G = GR.parse($('#rgIn').value);
      if (G.undefinedVars.length) throw new Error(`Variable(s) ${G.undefinedVars.join(', ')} have no productions.`);
      const r = GR.regularToNFA(G);
      store.set('rg', $('#rgIn').value);
      rgState = { G, r };
      renderRG();
    } catch (e) { showErr($('#rgErr'), e.message); }
  }
  function renderRG() {
    if (!rgState) return;
    const { G, r } = rgState;
    const stepRows = (steps) => ui.table(['production', 'edges added'], steps.map((s) => [esc(s.prod), esc(s.added.join(',  '))]), 'mono');
    let html = `<div class="summary">${chip('type', r.kind === 'right' ? 'right-linear' : 'left-linear')}${chip('start', esc(G.start))}${chip('V', esc('{' + G.vars.join(', ') + '}'))}${chip('T', esc(sigmaStr(G.terms)))}</div>`;
    const rule = `<p class="small muted">One state per variable plus a final state ${esc(r.kind === 'right' ? r.finalName : r.revNFA.finalName)}. A → w B becomes a path spelling w from A to B (extra states m1, m2, … for long strings). A → w goes to the final state. A → B is a λ-move.</p>`;
    if (r.kind === 'right') {
      html += stage('rg1', '1', 'Right-linear grammar → NFA', chip('states', r.fa.n), `${rule}${stepRows(r.steps)}${ui.slot(ui.faGraph(r.fa))}${ui.legend}${ui.faTable(r.fa)}`);
    } else {
      html += stage('rg1', '1', 'Reverse every right side', '', `<p class="small muted">A left-linear grammar for L becomes a right-linear grammar for Lᴿ when each right side is reversed.</p>${prodsHTML(GR.grouped(r.reversedGrammar))}`);
      html += stage('rg2', '2', 'NFA for the reversed grammar', chip('states', r.revNFA.fa.n), `${rule}${stepRows(r.steps)}${ui.slot(ui.faGraph(r.revNFA.fa))}`);
      html += stage('rg3', '3', 'Reverse the NFA', chip('states', r.fa.n), `<p class="small muted">Flip every arrow, make the old final state the start, and the old start (${esc(G.start)}) the final state.${r.note ? ' ' + esc(r.note) : ''}</p>${ui.slot(ui.faGraph(r.fa))}${ui.legend}${ui.faTable(r.fa)}`);
    }
    const sb = FA.subset(r.fa);
    html += subsetHTML(r.fa, sb, 'rgd', '');
    html += regexHTML(r.fa, FA.toRegex(r.fa), 'rgre', '');
    html += `<div class="btnRow">${loadBtn(r.fa, 'Open NFA in Draw FA')}${loadBtn(sb.fa, 'Open DFA in Draw FA')}</div>`;
    ui.put($('#rgOut'), html);
  }
  rerenders.rg = renderRG;
  $('#rgGo').addEventListener('click', runRG);

  // CFG & PDA
  let lastCfgOp = 'derive', cfgState = null;
  function derivHTML(forms) {
    return `<div class="deriv">${forms.map((f, i) => (i ? `<span class="arrow" title="${esc(f.prod)}">⇒</span>` : '') + `<span>${esc(f.form)}</span>`).join('')}</div>
      <details><summary>Productions used</summary><ol class="steps">${forms.slice(1).map((f) => `<li>${esc(f.prod)} &nbsp; gives &nbsp; ${esc(f.form)}</li>`).join('')}</ol></details>`;
  }
  function runCFG(op) {
    lastCfgOp = op;
    $$('[data-cfg]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cfg === op)));
    showErr($('#cfgErr'), '');
    try {
      const G = GR.parse($('#cfgIn').value);
      if (G.undefinedVars.length) throw new Error(`Variable(s) ${G.undefinedVars.join(', ')} have no productions.`);
      store.set('cfg', $('#cfgIn').value);
      const wRaw = $('#cfgW').value.trim();
      const w = DT.isEps(wRaw) ? '' : wRaw.replace(/\s+/g, '');
      const L = Math.max(1, Math.min(12, +$('#cfgLen').value || 6));
      cfgState = { G, op, w, L };
      if (op === 'derive') cfgState.res = GR.derive(G, w, 2);
      if (op === 'ambig') cfgState.res = GR.findAmbiguity(G, L);
      if (op === 'lang') cfgState.res = GR.enumerate(G, L);
      if (op === 'pda') cfgState.res = GR.cfgToPDA(G);
      renderCFG();
    } catch (e) { showErr($('#cfgErr'), e.message); }
  }
  function twoTrees(G, derivs, w) {
    return derivs.map((d, k) => {
      const rp = GR.replay(G, d);
      return `<div><div class="sub">Parse tree ${k + 1}</div>${ui.treeSlot(rp.tree)}<div class="sub">Leftmost derivation ${k + 1}</div>${derivHTML(rp.forms)}</div>`;
    }).join('') + (derivs.length < 2 ? '' : '') + (w ? '' : '');
  }
  function renderCFG() {
    if (!cfgState) return;
    const { G, op, w, L, res } = cfgState;
    let html = `<div class="summary">${chip('start', esc(G.start))}${chip('V', esc('{' + G.vars.join(', ') + '}'))}${chip('T', esc(sigmaStr(G.terms)))}${GR.isGNF(G) ? '<span class="chip">Greibach normal form</span>' : ''}${GR.classify(G).regular ? '<span class="chip">regular (linear) grammar</span>' : ''}</div>`;
    if (op === 'derive') {
      if (!res.derivs.length) {
        html += stage('cd', '', `Derive “${esc(w || EPS)}”`, '<span class="chip bad">not derived</span>', `<p>${res.hitBudget ? 'The search limit was reached before a derivation was found. The string may still be in L(G); try a shorter string.' : `“${esc(w || EPS)}” is not in L(G): no derivation exists.`}</p>`);
      } else {
        const rp = GR.replay(G, res.derivs[0]);
        html += stage('cd', '', `Derive “${esc(w || EPS)}”`, res.derivs.length > 1 ? '<span class="chip bad">ambiguous for this string</span>' : '<span class="chip ok">derived</span>',
          `<div class="sub">Leftmost derivation (LMD)</div>${derivHTML(rp.forms)}
           <div class="sub">Rightmost derivation (RMD), same tree</div>${derivHTML(GR.rightmostForms(rp.tree))}
           ${res.derivs.length > 1 ? '' : `<div class="sub">Parse tree</div>${ui.treeSlot(rp.tree)}`}
           ${res.derivs.length > 1 ? `<p><b>Two different leftmost derivations exist for “${esc(w)}”, so the grammar is ambiguous.</b> Both parse trees:</p><div class="cols">${twoTrees(G, res.derivs, w)}</div>` : '<p class="small muted">Only one leftmost derivation was found for this string.</p>'}`);
      }
    } else if (op === 'ambig') {
      html += res.found
        ? stage('ca', '', 'Ambiguity check', '<span class="chip bad">ambiguous</span>', `<p>The string <b class="mono">${esc(res.w || EPS)}</b> has two different leftmost derivations, so it has two parse trees. That proves G is ambiguous.</p><div class="cols">${twoTrees(G, res.derivs, res.w)}</div>`)
        : stage('ca', '', 'Ambiguity check', '<span class="chip ok">none found</span>', `<p>All ${res.checked} strings of length up to ${L} have exactly one leftmost derivation.${res.truncated ? ' (Search was cut short; the language has many strings.)' : ''}</p><p class="small muted">This is evidence, not a proof: ambiguity in general cannot be decided by any algorithm. Increase the max length to search further.</p>`);
    } else if (op === 'lang') {
      html += stage('cl', '', `Strings of L(G) up to length ${L}`, chip('found', res.list.length), `<div class="prods">${res.list.map((s) => esc(s || EPS)).join(', ') || 'none'}</div>${res.truncated ? '<p class="small muted">The list was cut short.</p>' : ''}`);
    } else if (op === 'pda') {
      const p = res;
      const grp = new Map();
      for (const t of p.trans) { const k = `δ(${t.from}, ${t.inp}, ${t.pop})`; if (!grp.has(k)) grp.set(k, { items: [], why: [] }); grp.get(k).items.push(`(${t.to}, ${t.push.length ? t.push.join('') : EPS})`); grp.get(k).why.push(t.why); }
      const rows = [...grp.entries()].map(([k, v]) => [esc(k) + ' = {' + esc(v.items.join(', ')) + '}', `<span class="muted">${esc([...new Set(v.why)].join('; '))}</span>`]);
      const pg = { nodes: p.states.map((s) => ({ id: s, label: s, start: s === p.start, final: p.finals.includes(s) })), edges: [] };
      const em = new Map();
      for (const t of p.trans) { const k = t.from + '>' + t.to; if (!em.has(k)) em.set(k, []); em.get(k).push(`${t.inp}, ${t.pop} / ${t.push.length ? t.push.join('') : EPS}`); }
      for (const [k, v] of em) { const [a, b] = k.split('>'); pg.edges.push({ from: a, to: b, label: v.join('\n') }); }
      html += stage('cp', '', 'CFG → NPDA', p.gnf ? '<span class="chip">GNF method</span>' : '<span class="chip">general method</span>',
        `<p>${esc(p.notes[0])}</p><p class="mono small">M = ({q0, q1, qf}, ${esc(sigmaStr(p.inputSyms))}, ${esc(sigmaStr(p.stackSyms))}, δ, q0, ${esc(p.z)}, {qf})</p>
         ${ui.table(['transition', 'from'], rows, 'mono')}${ui.slot(pg)}
         <div class="btnRow"><button type="button" class="ghost" id="usePda">Use in NPDA simulator</button></div>`);
    }
    ui.put($('#cfgOut'), html);
    const u = $('#usePda');
    if (u) u.addEventListener('click', () => {
      $('#pdaIn').value = ui.D(GR.pdaText(res.trans));
      pdaFromCfg = { text: $('#pdaIn').value, trans: res.trans }; $('#pdaStart').value = 'q0'; $('#pdaZ').value = res.z; $('#pdaF').value = 'qf'; $('#pdaMode').value = 'final';
      $('#pdaW').value = w || ui.eps;
      runPDA(); $('#pdaCard').scrollIntoView({ block: 'start' });
    });
  }
  rerenders.cfg = renderCFG;
  $$('[data-cfg]').forEach((b) => b.addEventListener('click', () => runCFG(b.dataset.cfg)));

  let pdaFromCfg = null;
  function runPDA() {
    showErr($('#pdaErr'), '');
    try {
      const trans = pdaFromCfg && pdaFromCfg.text === $('#pdaIn').value ? pdaFromCfg.trans : GR.parsePDA($('#pdaIn').value);
      if (!trans.length) throw new Error('Write at least one transition.');
      const pda = { start: $('#pdaStart').value.trim(), z: $('#pdaZ').value.trim() || 'z', finals: $('#pdaF').value.split(/[\s,{}]+/).filter(Boolean), trans };
      const raw = $('#pdaW').value.trim();
      const w = DT.isEps(raw) ? '' : raw.replace(/\s+/g, '');
      const mode = $('#pdaMode').value;
      const r = GR.simulatePDA(pda, w, mode);
      const W = [...w];
      const html = r.accepted
        ? `<p><span class="chip ok">accepted</span> <span class="small muted">by ${mode === 'final' ? 'final state' : 'empty stack'}</span></p><div class="sub">Instantaneous descriptions</div><div class="ids">${r.path.map((c) => `<span>${esc(GR.idStr(c, W))}</span>`).join(' ⊢ ')}</div>`
        : `<p><span class="chip bad">rejected</span> <span class="small muted">${r.hitBudget ? 'search limit reached' : `no computation accepts it (${r.explored} configurations tried)`}</span></p>`;
      ui.put($('#pdaOut'), html);
    } catch (e) { showErr($('#pdaErr'), e.message); }
  }
  $('#pdaForm').addEventListener('submit', (e) => { e.preventDefault(); runPDA(); });

  // PARSING (syntax analysis)
  const PS = DT.parsing;
  let lastPsOp = 'ff';
  const grammars = new Map();
  const okChip = (t) => `<span class="chip ok">✓ ${esc(t)}</span>`;
  const badChip = (t) => `<span class="chip bad">✗ ${esc(t)}</span>`;
  const psSet = (S, order) => esc(PS.setStr(S, order));
  const gramBlock = (G) => `<div class="prods">${PS.grouped(G).map((g) => `<span class="v">${esc(g.lhs)}</span> → ${g.rhs.map(esc).join(' | ')}`).join('\n')}</div>`;
  const useBtn = (G, text = 'Use this grammar') => { const id = 'G' + ++loadId; grammars.set(id, G); return `<button type="button" class="ghost" data-usegram="${id}">${text}</button>`; };
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
      traceHTML = traceTable(['Stack', 'Input', 'Action', 'Handle'], r.rows.map((x) => [esc(x.stack), inputCell(x.input), esc(x.action), esc(x.handle || '')]), r.accepted);
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

  // boot
  const savedRE = store.get('re'); if (savedRE) $('#reIn').value = savedRE;
  const savedRG = store.get('rg'); if (savedRG) $('#rgIn').value = savedRG;
  const savedCFG = store.get('cfg'); if (savedCFG) $('#cfgIn').value = savedCFG;
  setEps(ui.eps);
  const savedPS = store.get('ps'); if (savedPS) $('#psIn').value = savedPS;
  const savedPW = store.get('psw'); if (savedPW) $('#psW').value = savedPW;
  const savedPP = store.get('psprec'); if (savedPP !== null) $('#psPrec').value = savedPP;
  runRE(); runRG(); runCFG('derive'); runPDA(); runLang(); runPS('ff');
  showTab((location.hash || '#re').slice(1), false);
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t)) showTab(t, false); });
})(window.DT);
