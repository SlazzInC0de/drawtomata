/* RE → FA tool. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, FA, RX, esc, $, store, showErr, loadBtn, rerenders, stage, chip, blank, emptyState, sigmaStr, thompsonHTML, removeEpsHTML, subsetHTML, STEP_MAX, stepLimit, minimizeHTML, testRows, splitList } = App;
  // RE → FA
  let reState = null;
  function runRE() {
    const src = $('#reIn').value;
    showErr($('#reErr'), '');
    if (blank('#reIn')) { reState = null; store.set('re', ''); emptyState($('#reOut'), 'Type a regular expression', 'Use + for union, * for star and λ for the empty string. It is converted to a λ-NFA, an NFA, a DFA and the minimal DFA, step by step.', 're'); return; }
    let ast;
    try { ast = RX.parse(src); } catch (e) { showErr($('#reErr'), e.message); return; }
    store.set('re', src);
    try {
      const t = FA.thompson(ast);
      const ef = FA.removeEps(t.fa);
      const sb = FA.subset(t.fa);
      if (sb.fa.n > STEP_MAX) throw new Error(stepLimit(sb.fa.n, 'The DFA for this expression'));
      const mn = FA.minimize(sb.fa);
      reState = { src, ast, t, ef, sb, mn };
    } catch (e) { showErr($('#reErr'), e.message); return; }
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
      `<form class="row wrapRow" id="reTestForm"><label class="sr" for="reTest">Strings</label><input id="reTest" class="mono" placeholder="e.g. abb, aabb, ${ui.eps}" value="${esc(store.get('retest') || '')}"><button class="ghost" type="submit">Run</button></form><div id="reTestOut"></div>
       <div class="btnRow">${loadBtn(mn.min, 'Open minimal DFA in Draw FA')}${loadBtn(t.fa, 'Open λ-NFA in Draw FA')}${loadBtn(sb.fa, 'Open DFA in Draw FA')}</div>`);
    ui.put($('#reOut'), html);
    $('#reTestForm').addEventListener('submit', (e) => { e.preventDefault(); runReTest(); });
    runReTest();
  }
  function runReTest() {
    const v = $('#reTest').value; store.set('retest', v);
    if (!v.trim()) { ui.put($('#reTestOut'), `<p class="small muted">Type strings separated by commas and press Run. Use ${ui.eps} for the empty string.</p>`); return; }
    ui.put($('#reTestOut'), ui.table(['string', 'result', 'run'], testRows(reState.mn.min, splitList(v)), 'mono'));
  }
  rerenders.re = renderRE;
  $('#reForm').addEventListener('submit', (e) => { e.preventDefault(); runRE(); });

  App.export({ runRE: () => runRE });
})(window.DT);
