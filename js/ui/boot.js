/* Boot: first-visit banner, blank inputs, and the first tab to show. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, $, $$, store, TABS, showTab, setEps, emptyState } = App;
  // first-visit banner: examples run only when asked, inputs stay blank otherwise
  const welcome = $('#welcome');
  const closeWelcome = () => { welcome.hidden = true; store.set('welcomed', '1'); };
  if (!store.get('welcomed')) welcome.hidden = false;
  $('#welcomeX').addEventListener('click', closeWelcome);
  const fillTab = (t) => $$(`#tab-${t} [data-example]`).forEach((el) => { if (!el.value.trim()) el.value = ui.D(el.dataset.example); });
  const TRY = {
    re: () => { showTab('re'); fillTab('re'); App.runRE(); },
    fa: () => { showTab('fa'); App.editor.load(App.exFA(App.EX.endsab), { rename: false }); App.runOp('dfa'); },
    parse: () => { showTab('parse'); fillTab('parse'); App.runPS('ll1'); },
    lex: () => { showTab('lex'); fillTab('lex'); App.runLx('ph'); }
  };
  welcome.addEventListener('click', (e) => {
    const b = e.target.closest('[data-try]');
    if (!b) return;
    closeWelcome(); TRY[b.dataset.try](); window.scrollTo(0, 0);
  });
  const FILL_RUN = { re: App.runRE, rg: App.runRG, cfg: () => { App.runCFG(App.lastCfgOp || 'derive'); App.runPDA(); }, parse: () => App.runPS(), sdt: () => App.runSD(), cg: () => App.runCG(), lex: () => App.runLx(), pump: () => App.runPump() };

  // boot: every input starts blank, so nothing is converted until the visitor types something
  // (clearing here also undoes the browser's own form restore on reload)
  $$('[data-example], #cgLive').forEach((el) => { el.value = ''; });
  $('#pmLang').value = '';
  store.set('retest', ''); store.set('fatest', '');
  setEps(ui.eps);
  App.runRE(); App.runRG(); App.runCFG('derive'); App.runPDA(); App.runPS('ff');
  emptyState($('#langOut'), 'Describe a language', 'Choose Σ and one or two conditions above, then press Build DFA.');
  App.runPump();
  App.runCG('tac');
  App.runSD('tree');
  App.runLx(store.get('lxop') || 'ph');
  showTab((location.hash || '#' + (App.PAGE.tab || 're')).slice(1), false);
  if (!location.hash && App.PAGE.op) {
    if (App.PAGE.tab === 'fa') { if (App.editor.count && App.editor.count()) App.runOp(App.PAGE.op); }
    else if (App.PAGE.tab === 'parse') App.runPS(App.PAGE.op);
    else if (App.PAGE.tab === 'cg') App.runCG(App.PAGE.op);
    else if (App.PAGE.tab === 'sdt') App.runSD(App.PAGE.op);
    else if (App.PAGE.tab === 'lex') App.runLx(App.PAGE.op);
    else if (App.PAGE.tab === 'cfg') App.runCFG(App.PAGE.op);
  }
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t)) { showTab(t, false); window.scrollTo(0, 0); } });

  App.export({ FILL_RUN: () => FILL_RUN });
})(window.DT);
