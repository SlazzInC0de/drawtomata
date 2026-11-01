/* Pumping lemma tool. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, EPS, esc, $, $$, store, showErr, rerenders, stage, chip, blank, emptyState } = App;
  // PUMPING LEMMA
  const pmLang = $('#pmLang');
  pmLang.innerHTML = '<option value="">Choose a language</option>' + Object.entries(App.TH.LANGUAGES).map(([k, L]) => `<option value="${k}">${esc(L.name)}</option>`).join('');
  const pmMode = () => ($$('input[name="pmMode"]').find((x) => x.checked) || {}).value || 'non';
  function syncPm() {
    const reg = pmMode() === 'reg';
    $('#pmLangField').hidden = reg; $('#pmReField').hidden = !reg; $('#pmPField').hidden = reg;
  }
  $$('input[name="pmMode"]').forEach((x) => x.addEventListener('change', () => { syncPm(); $('#pmW').value = ''; runPump(); }));
  pmLang.addEventListener('change', () => { $('#pmW').value = ''; runPump(); });
  $('#pmGo').addEventListener('click', () => runPump());
  ['#pmW', '#pmRe', '#pmP'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') runPump(); }));
  const lemmaBox = `<div class="formula" style="white-space:normal">If L is regular, there is a p ≥ 1 such that every w ∈ L with |w| ≥ p can be written w = xyz with |xy| ≤ p and |y| ≥ 1, so that xyⁱz ∈ L for every i ≥ 0.</div>`;
  const splitView = (x, y, z) => `<span class="wsplit"><span class="x">${esc(x)}</span>${y ? `<span class="y">${esc(y)}</span>` : ' '}<span class="z">${esc(z)}</span></span>`;
  function splitsTable(res, showStrings) {
    const rows = res.rows.map((r, n) => {
      const cells = r.results.filter((q) => [0, 1, 2, 3].includes(q.i)).map((q) => ({ v: (showStrings ? esc(q.s || EPS) + ' ' : '') + (q.inL ? '✓' : '✗'), cls: q.inL ? 'yes' : 'no' }));
      return [String(n + 1), esc(r.x || EPS), esc(r.y), esc(r.z || EPS), ...cells, r.failsAt === null ? { v: 'pumps for i = 0…5', cls: 'yes' } : { v: `out of L at i = ${r.failsAt}`, cls: 'no' }];
    });
    return App.grid(['#', 'x', 'y', 'z', 'i = 0', 'i = 1', 'i = 2', 'i = 3', 'Result'], rows).replace(/<tr><td>(\d+)<\/td>((?:(?!<\/tr>).)*?pumps for)/g, '<tr class="pumps"><td>$1</td>$2');
  }
  function runPump() {
    showErr($('#pmErr'), '');
    syncPm();
    if (pmMode() === 'reg' ? blank('#pmRe') : !pmLang.value) { emptyState($('#pmOut'), pmMode() === 'reg' ? 'Type a regular expression' : 'Choose a language', pmMode() === 'reg' ? 'The minimal DFA gives p, and the pigeonhole principle gives a split that always pumps.' : 'Pick a non-regular language such as aⁿbⁿ to play the pumping-lemma game against every split xyz.', 'pump'); return; }
    const wRaw = $('#pmW').value.trim();
    const w = DT.isEps(wRaw) ? '' : wRaw.replace(/\s+/g, '');
    let html = '';
    try {
      if (pmMode() === 'reg') {
        const re = $('#pmRe').value;
        let r = App.TH.pumpingRegular(re, w || 'a');
        if (!wRaw) {
          // pick the shortest string in L with length ≥ p
          const A = DT.fa.alphabetOf(r.dfa);
          let found = null, frontier = [''];
          for (let len = 0; len <= r.p + 6 && !found; len++) {
            for (const s of frontier) if (s.length >= r.p && DT.fa.accepts(r.dfa, s).ok) { found = s; break; }
            frontier = frontier.flatMap((s) => A.map((c) => s + c)).slice(0, 4000);
          }
          if (!found) throw new Error('L has no string of length ≥ p, so the lemma holds trivially.');
          $('#pmW').value = found;
          r = App.TH.pumpingRegular(re, found);
        }
        store.set('pmre', re);
        const g = ui.faGraph(r.dfa);
        html += stage('pm-lemma', '', 'The pumping lemma', '', lemmaBox);
        html += stage('pm-reg', '', `L(${esc(re)}) is regular, so the lemma holds`, chip('p = states of the minimal DFA', r.p) + (r.problems.length ? App.badChip('w cannot be used') : r.split && r.check.every((c) => c.inL) ? App.okChip('split found and it pumps') : ''),
          `${r.problems.map((p) => `<p><b>${esc(p)}</b></p>`).join('')}
           <div class="cols"><div><div class="sub">Minimal DFA (${r.p} states)</div>${ui.slot(g)}</div>
           <div><div class="sub">Why a split always exists (pigeonhole)</div>
             <p>Reading the first p symbols of w visits p + 1 states, but there are only p states, so some state repeats. The symbols read between the two visits form a loop: that loop is y.</p>
             <p class="mono small">${r.seq.map((s, i) => (r.split && (i === r.split.from || i === r.split.to) ? `<b style="color:var(--accent)">${esc(s)}</b>` : esc(s))).join(' → ')}</p>
             ${r.split ? `<p>State <b>${esc(r.split.state)}</b> repeats after ${r.split.from} and ${r.split.to} symbols, giving</p><p>${splitView(r.split.x, r.split.y, r.split.z)}</p>
             <p class="small">x = ${esc(r.split.x || EPS)}, y = ${esc(r.split.y)}, z = ${esc(r.split.z || EPS)}</p>` : ''}
           </div></div>
           ${r.split ? `<div class="sub">Pumping that split</div>${ui.table(['i', 'xyⁱz', 'in L?'], r.check.map((c) => [String(c.i), esc(c.s || EPS), c.inL ? '<span class="chip ok">✓ yes</span>' : '<span class="chip bad">✗ no</span>']), 'mono')}` : ''}
           <details><summary>All ${r.rows.length} splits with |xy| ≤ p (${r.pumpable.length} of them pump)</summary>${splitsTable(r, false)}</details>`);
      } else {
        const key = pmLang.value;
        const p = Math.max(1, Math.min(10, +$('#pmP').value || 4));
        const g = App.TH.pumpingGame(key, p, wRaw ? w : undefined);
        if (!wRaw) $('#pmW').value = g.w;
        store.set('pmlang', key);
        const allFail = g.pumpable.length === 0 && !g.problems.length;
        const sweepOk = g.sweep.every((s) => s.defeated);
        html += stage('pm-lemma', '', 'The pumping lemma as a game', '',
          `${lemmaBox}
           <ol class="steps" style="font-family:inherit;font-size:14px">
             <li>The adversary picks p. Here p = <b>${p}</b>.</li>
             <li>You pick w ∈ L with |w| ≥ p. The standard choice is <b class="mono">${esc(g.L.w)}</b>, here <b class="mono">${esc(g.w)}</b>.</li>
             <li>The adversary splits w = xyz with |xy| ≤ p and |y| ≥ 1. Every possible split is listed below.</li>
             <li>You pick i so that xyⁱz ∉ L. If you can do this for every split, the adversary loses for this p.</li>
           </ol>`);
        html += stage('pm-game', '', `L = { ${esc(g.L.name)} }`,
          (g.problems.length ? App.badChip('w cannot be used') : allFail ? App.okChip(`all ${g.rows.length} splits break`) : App.badChip(`${g.pumpable.length} split${g.pumpable.length > 1 ? 's' : ''} survive pumping`)) + (sweepOk ? App.okChip('the standard w wins for every p from 1 to 8') : ''),
          `${g.problems.map((pr) => `<p><b>${esc(pr)}</b></p>`).join('')}
           ${g.problems.length ? '' : `<p>${splitView(g.w.slice(0, p), '', g.w.slice(p))} <span class="small muted">the first p = ${p} symbols are where y must lie</span></p>
           ${splitsTable(g, true)}
           ${allFail ? `<div class="sub">Conclusion</div><p>${esc(g.L.why)}</p><p>Every split of w = ${esc(g.w)} leaves L for some i, so no split works for p = ${p}. The same choice of w works for any p, so no p can satisfy the lemma: <b>L is not regular</b>.</p>`
             : `<div class="sub">This w does not win</div><p>The highlighted split${g.pumpable.length > 1 ? 's' : ''} stay in L for every i tried, so the adversary would choose ${g.pumpable.length > 1 ? 'one of them' : 'it'}. Pick a w that forces y into a part of the string where pumping must break membership, or clear w to use ${esc(g.L.w)}.</p>`}`}`);
      }
    } catch (e) { showErr($('#pmErr'), e.message); return; }
    ui.put($('#pmOut'), html);
  }
  rerenders.pump = () => runPump();

  App.export({ runPump: () => runPump });
})(window.DT);
