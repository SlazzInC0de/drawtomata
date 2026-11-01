/* Grammar ⇄ FA tool. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, FA, GR, esc, $, store, showErr, loadBtn, rerenders, stage, chip, blank, emptyState, sigmaStr, subsetHTML, regexHTML, prodsHTML } = App;
  // GRAMMAR ⇄ FA
  let rgState = null;
  function runRG() {
    showErr($('#rgErr'), '');
    if (blank('#rgIn')) { rgState = null; store.set('rg', ''); emptyState($('#rgOut'), 'Type a regular grammar', 'One production per line, right-linear (S -> aA) or left-linear (S -> Aa). It is turned into an NFA.', 'rg'); return; }
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

  App.export({ runRG: () => runRG });
})(window.DT);
