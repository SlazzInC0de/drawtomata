/* Draw FA tool: the canvas editor and its operations. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, FA, EPS, esc, $, $$, store, loadBtn, rerenders, removeEpsHTML, subsetHTML, STEP_MAX, stepLimit, minimizeHTML, regexHTML, rlgHTML, llgHTML, testRows, splitList } = App;
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
  // a converter page (e.g. /nfa-to-dfa/) names its tab, operation and example on <body>
  const PAGE = document.body.dataset;
  try {
    const saved = store.get('editor');
    if (saved && (JSON.parse(saved).states || JSON.parse(saved).s || []).length) {
      editor.restore(saved);
      const f = editor.toFA(), ex = exFA(EX.minme);
      if (f.n === ex.n && f.trans.length === ex.trans.length && FA.equivalent(f, ex).eq) editor.clear();
    }
  }
  catch (e) {
    // Keep the unreadable autosave so starting with an empty canvas does not silently lose the user's work.
    try { const saved = store.get('editor'); if (saved) store.set('editor-backup', saved); } catch (e2) { /* ignore */ }
    editor.clear();
    toast('Your saved automaton could not be opened. A copy was kept in browser storage as dt-editor-backup.');
  }

  let lastOp = null;
  const elimOrder = () => store.get('elim') || '';
  const testList = () => store.get('fatest') || '';
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
        if (sb.fa.n > STEP_MAX) throw new Error(stepLimit(sb.fa.n, 'The DFA'));
        html = (FA.isDFA(src) ? '<p class="small muted">Already deterministic. The table still shows the subset view; missing moves go to ∅.</p>' : '') + subsetHTML(src, sb, 'st-dfa', '') + `<div class="btnRow">${loadBtn(sb.fa, 'Load DFA into canvas')}</div>`;
      } else if (op === 'min') {
        const big = FA.isDFA(src) ? src.n : FA.subset(src).fa.n;
        if (big > STEP_MAX) throw new Error(stepLimit(big, 'The DFA to minimize'));
        const m = FA.minimize(src);
        html = minimizeHTML(src, m, 'st-min', '') + `<div class="btnRow">${loadBtn(m.min, 'Load minimal DFA into canvas')}</div>`;
      } else if (op === 're') {
        const order = splitList(elimOrder());
        html = `<form class="drawerForm" id="elimForm"><div class="field"><label class="lbl" for="elimOrder">Elimination order (optional)</label><input id="elimOrder" class="mono" placeholder="shortest result, or e.g. q1, q2" value="${esc(elimOrder())}" autocomplete="off"></div><button class="ghost" type="submit">Apply</button></form>` +
          regexHTML(src, FA.toRegex(src, order.length ? order : null));
      } else if (op === 'rlg') html = rlgHTML(src);
      else if (op === 'llg') html = llgHTML(src);
      else if (op === 'test') {
        html = `<form class="drawerForm" id="faTestForm"><div class="field"><label class="lbl" for="faTest">Strings, comma separated</label><input id="faTest" class="mono" placeholder="e.g. ab, aab, ${ui.eps}" value="${esc(ui.D(testList()))}" autocomplete="off"></div><button class="primary" type="submit">Run</button></form>` +
          (testList().trim() ? ui.table(['string', 'result', FA.isDFA(src) ? 'run' : 'states after each symbol'], testRows(src, splitList(testList())), 'mono') : `<p class="small muted">Type strings separated by commas and press Run. Use ${ui.eps} for the empty string.</p>`);
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

  App.export({ editor: () => editor, EX: () => EX, exFA: () => exFA, toast: () => toast, closeDrawer: () => closeDrawer, PAGE: () => PAGE, runOp: () => runOp });
})(window.DT);
