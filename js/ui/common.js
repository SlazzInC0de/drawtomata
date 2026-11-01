/* Shared page helpers: tabs, theme, result stages, chips and the automaton views used by several tools. */
(function (DT) {
  'use strict';
  const App = (DT.app = DT.app || {});
  // other files read shared names through App; getters keep them live
  App.export = (getters) => { for (const [k, get] of Object.entries(getters)) Object.defineProperty(App, k, { get, enumerable: true }); };
  const { ui, fa: FA, regex: RX, grammar: GR, EPS } = DT;
  const { esc, $, $$ } = ui;
  const store = {
    get(k) { try { return localStorage.getItem('dt-' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('dt-' + k, v); } catch (e) { /* ignore */ } }
  };
  const showErr = (el, msg) => { el.textContent = msg ? ui.D(msg) : ''; el.hidden = !msg; };
  const loadables = new Map();
  let loadId = 0;
  const nextId = () => ++loadId;
  const loadBtn = (fa, text = 'Open in Draw FA') => { const id = 'L' + nextId(); loadables.set(id, fa); return `<button type="button" class="ghost" data-load="${id}">${text}</button>`; };
  ui.showDead = store.get('dead') === '1';
  const rerenders = {};

  // tabs
  const TABS = ['re', 'fa', 'lang', 'rg', 'cfg', 'lex', 'parse', 'sdt', 'cg', 'pump'];
  function showTab(t, push = true) {
    if (!TABS.includes(t)) t = 're';
    const group = $(`.subModes [data-tab="${t}"]`).dataset.group;
    lastInGroup[group] = t;
    $$('.modes [data-group]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.group === group)));
    $$('.subModes [data-tab]').forEach((b) => { b.hidden = b.dataset.group !== group; b.setAttribute('aria-selected', String(b.dataset.tab === t)); });
    TABS.forEach((x) => ($('#tab-' + x).hidden = x !== t));
    if (push) { try { history.replaceState(null, '', '#' + t); } catch (e) { /* ignore */ } }
    if (t === 'fa') { App.editor.redraw(); if (!fittedOnce) { fittedOnce = true; App.editor.fit(); } }
  }
  let fittedOnce = false;
  const lastInGroup = {};
  $$('.subModes [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.modes [data-group]').forEach((b) => b.addEventListener('click', () => {
    const g = b.dataset.group;
    showTab(lastInGroup[g] || $(`.subModes [data-group="${g}"]`).dataset.tab);
  }));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { e.preventDefault(); showTab(g.dataset.goto); window.scrollTo(0, 0); }
    const l = e.target.closest('[data-load]');
    if (l && loadables.has(l.dataset.load)) {
      showTab('fa'); window.scrollTo(0, 0);
      const renamed = App.editor.load(loadables.get(l.dataset.load));
      App.closeDrawer();
      App.toast(renamed ? 'Loaded. States were renamed q0, q1, … to keep them short.' : 'Loaded into the canvas.');
    }
  });

  /* empty-string symbol switch */
  function setEps(v) {
    ui.eps = v; store.set('eps', v);
    $$('[data-eps]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.eps === v)));
    $$('[data-ins="λ"]').forEach((b) => (b.textContent = v));
    Object.values(rerenders).forEach((f) => f && f());
    App.editor.redraw();
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
    if (x.dataset.for === 'reIn') App.runRE();
    if (x.dataset.for === 'rgIn') App.runRG();
    if (x.dataset.for === 'cfgIn') App.runCFG(App.lastCfgOp);
    if (x.dataset.for === 'psIn') App.runPS();
    if (x.dataset.for === 'lxStmt') App.runLx('ph');
    if (x.dataset.for === 'lxPats') { if (b.dataset.in) $('#lxPatIn').value = b.dataset.in; App.runLx('re'); }
    if (x.dataset.for === 'sdIn') { if (b.dataset.w) $('#sdW').value = b.dataset.w; App.runSD(b.dataset.op || (App.lastSdOp === 'st' || App.lastSdOp === 'cls' ? 'tree' : App.lastSdOp)); }
    if (x.dataset.for === 'cgIn') { $('#cgLive').value = b.dataset.live || ''; App.runCG(); }
  }));

  // shared result pieces
  const stage = (id, num, title, meta, body) =>
    `<section class="stage" id="${id}"><div class="stage-h">${num ? `<span class="num">${num}</span>` : ''}<h2>${title}</h2><div class="meta">${meta || ''}</div></div>${body}</section>`;
  const chip = (k, v) => `<span class="chip">${k} <b>${v}</b></span>`;
  // every tab starts empty; "Load the example" fills the tab's fields from their data-example
  const blank = (sel) => !$(sel).value.trim();
  const emptyState = (el, title, hint, tab) => ui.put(el, `<div class="emptyState"><h2>${title}</h2><p>${hint}</p>${tab ? `<button type="button" class="ghost" data-fill="${tab}">Load the example</button>` : ''}</div>`);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fill]');
    if (!b) return;
    $$(`#tab-${b.dataset.fill} [data-example]`).forEach((el) => { if (!el.value.trim()) el.value = ui.D(el.dataset.example); });
    if (b.dataset.fill === 'pump' && !$('#pmLang').value) $('#pmLang').value = 'anbn';
    (App.FILL_RUN[b.dataset.fill] || (() => {}))();
  });
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

  const LEARN_MAX = 300;
  function subsetHTML(src, sb, id = 'st-dfa', num = '3') {
    const L = src.labels, dfa = sb.fa;
    const T = new Map(dfa.trans.map((t) => [t.from + '|' + t.sym, t.to]));
    const rows = sb.sets.map((S, i) => [ui.stateCell(dfa, i), setOf(L, S), ...sb.alphabet.map((a) => esc(dfa.labels[T.get(i + '|' + a)]))]);
    const eq = FA.equivalent(src, dfa);
    const hasDead = dfa.labels.includes('∅');
    const first = sb.sets[0];
    const body = `<div class="formula">Start: A = λ-closure(${esc(L[src.start])}) = ${setOf(L, first).replace(/<[^>]+>/g, '')}  ·  Next: λ-closure( move(S, a) )  ·  final if S contains a final state</div>
      ${dfa.n * sb.alphabet.length <= LEARN_MAX ? DT.learn.button(DT.learn.subsetSteps(src, sb)) : ''}
      ${ui.table(['DFA state', 'set of NFA states', ...sb.alphabet.map(esc)], rows, 'mono')}
      ${hasDead ? '<p class="small muted">∅ is the trap (dead) state: once there, the string can never be accepted.</p>' : ''}
      ${ui.slot(ui.faGraph(dfa, { hide: hideFor(dfa) }))}${ui.legend}`;
    return stage(id, num, 'NFA → DFA (subset construction)', chip('states', dfa.n) + verifyChip(eq) + deadToggle(), body);
  }

  const MARK_MAX = 40, LIST_MAX = 80, STEP_MAX = 512;
  const stepLimit = (n, what) => `${what} has ${n} states. That is too large to show step by step (limit ${STEP_MAX}). Try a smaller input.`;
  function minimizeHTML(src, m, id = 'st-min', num = '4') {
    const L = m.labels, n = m.dfa.n;
    let mark = '';
    if (n > MARK_MAX) mark = `<p class="small muted">The table would have ${n * (n - 1) / 2} cells, so it is skipped for ${n} states (limit ${MARK_MAX}). The passes below still list what was marked.</p>`;
    else if (n > 1) {
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
    const few = (arr, f, sep) => arr.slice(0, LIST_MAX).map(f).join(sep) + (arr.length > LIST_MAX ? `${sep}<span class="muted">… and ${arr.length - LIST_MAX} more</span>` : '');
    const passList = m.passes.map((p, k) => k === 0
      ? `<li><b>Pass 0</b>: mark every (final, non-final) pair: ${p.length ? few(p, (x) => pair(x.i, x.j), ' ') : 'none'}</li>`
      : `<li><b>Pass ${k}</b>: ${few(p, (x) => `${pair(x.i, x.j)} on ${esc(x.a)} → ${pair(x.to[0], x.to[1])}`, ', ')}</li>`).join('') +
      `<li><b>Pass ${m.passes.length}</b>: nothing new is marked, stop. Unmarked pairs (=) are indistinguishable.</li>`;
    const partList = m.partitions.map((p, k) => `<div>π<sub>${k}</sub> = ${few(p, (g) => `<span class="grp">{${g.map((q) => esc(L[q])).join(',')}}</span>`, '')}</div>`).join('') +
      `<div class="muted">π<sub>${m.partitions.length}</sub> = π<sub>${m.partitions.length - 1}</sub>, so stop.</div>`;
    const merged = m.groups.filter((g) => g.length > 1);
    const eq = FA.equivalent(src, m.min);
    const body = `${m.notes.length ? `<ul class="steps">${m.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <p>${merged.length ? `Merged: ${merged.map((g) => `<b class="mono">{${g.map((q) => esc(L[q])).join(',')}}</b>`).join(', ')}.` : 'No two states are equivalent, so the DFA is already minimal.'}</p>
      <div class="cols">
        <div><div class="sub">Mark procedure (table filling)</div>${n > 1 && n <= MARK_MAX ? DT.learn.button(DT.learn.minimizeSteps(m)) : ''}${mark || '<p class="small muted">Only one state.</p>'}<ol class="steps" start="0">${passList}</ol></div>
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
    if (r) { $('#reIn').value = ui.D(r.dataset.re); showTab('re'); App.runRE(); window.scrollTo(0, 0); }
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

  App.export({ ui: () => ui, FA: () => FA, RX: () => RX, GR: () => GR, EPS: () => EPS, esc: () => esc, $: () => $, $$: () => $$, store: () => store, showErr: () => showErr, nextId: () => nextId, loadBtn: () => loadBtn, rerenders: () => rerenders, TABS: () => TABS, showTab: () => showTab, setEps: () => setEps, stage: () => stage, chip: () => chip, blank: () => blank, emptyState: () => emptyState, hideFor: () => hideFor, sigmaStr: () => sigmaStr, thompsonHTML: () => thompsonHTML, removeEpsHTML: () => removeEpsHTML, LEARN_MAX: () => LEARN_MAX, subsetHTML: () => subsetHTML, STEP_MAX: () => STEP_MAX, stepLimit: () => stepLimit, minimizeHTML: () => minimizeHTML, regexHTML: () => regexHTML, prodsHTML: () => prodsHTML, rlgHTML: () => rlgHTML, llgHTML: () => llgHTML, testRows: () => testRows, splitList: () => splitList });
})(window.DT);
