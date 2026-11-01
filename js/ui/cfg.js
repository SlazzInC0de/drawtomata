/* CFG & PDA tool, including NPDA → CFG. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, GR, EPS, esc, $, $$, store, showErr, rerenders, stage, chip, blank, emptyState, sigmaStr } = App;
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
    if (blank('#cfgIn')) { store.set('cfg', ''); emptyState($('#cfgOut'), 'Type a context-free grammar', 'One production per line, such as E -> E+E | E*E | (E) | a. Then get derivations, parse trees, an ambiguity check or an NPDA.', 'cfg'); return; }
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
    if (blank('#pdaIn')) { $('#pdaOut').innerHTML = ''; return; }
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

  // NPDA → CFG (CFG & PDA tab)
  function runPdaToCfg() {
    showErr($('#pdaErr'), '');
    try {
      const trans = pdaFromCfg && pdaFromCfg.text === $('#pdaIn').value ? pdaFromCfg.trans : GR.parsePDA($('#pdaIn').value);
      if (!trans.length) throw new Error('Write at least one transition.');
      const pda = { start: $('#pdaStart').value.trim(), z: $('#pdaZ').value.trim() || 'z', finals: $('#pdaF').value.split(/[\s,{}]+/).filter(Boolean), trans };
      const mode = $('#pdaMode').value;
      const r = App.TH.pdaToCfg(pda, mode);
      // compare with the simulator on every short input
      const sigma = [...new Set(trans.map((t) => t.inp).filter((a) => a !== EPS))].sort();
      const maxLen = sigma.length > 3 ? 4 : 5;
      let all = [''];
      for (let i = 0; i < maxLen; i++) all = all.concat(all.filter((s) => s.length === i).flatMap((s) => sigma.map((c) => s + c)));
      const gen = App.PS.enumerate(r.trimmed, maxLen + 1);
      const L = new Set(gen.list.map((x) => x.join('')));
      const miss = all.find((w) => GR.simulatePDA(pda, w, mode).accepted !== L.has(w));
      const verdict = miss === undefined ? App.okChip(`grammar and NPDA agree on all ${all.length} strings up to length ${maxLen}`) : App.badChip(`disagree on "${miss || EPS}"`);
      const moveRows = r.moves.map((t) => [esc(`δ(${t.from}, ${t.inp}, ${t.pop}) ∋ (${t.to}, ${t.push.join('') || EPS})`), `<span class="muted">${esc(t.why)}</span>`]);
      const byLhs = new Map();
      for (const p of r.trimmed.prods) { const k = r.display(p.lhs); if (!byLhs.has(k)) byLhs.set(k, []); byLhs.get(k).push(p.rhs.length ? p.rhs.map(r.display).join(' ') : EPS); }
      const prodText = [...byLhs].map(([k, v]) => `<span class="v">${esc(k)}</span> → ${v.map(esc).join(' | ')}`).join('\n');
      const html = stage('pda-cfg', '', 'NPDA → context-free grammar', verdict + chip('useful productions', r.trimmed.prods.length) + chip('generated', r.prods.length),
        `<div class="formula" style="white-space:normal">[qᵢ A qⱼ] derives w exactly when the NPDA can go from qᵢ to qⱼ reading w and popping A · δ(qᵢ, a, A) ∋ (qⱼ, ${EPS}) gives [qᵢ A qⱼ] → a · δ(qᵢ, a, A) ∋ (qⱼ, BC) gives [qᵢ A qₖ] → a [qⱼ B qₗ][qₗ C qₖ] for all qₖ, qₗ</div>
         <div class="sub">1. Put the NPDA in Linz form</div>
         <p>One final state ${esc(r.qf)}, entered only with an empty stack, and every move pops one symbol and pushes zero or two.</p>
         ${r.notes.length ? `<ul class="steps" style="font-family:inherit;font-size:14px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
         <details><summary>All ${r.moves.length} moves after normalizing</summary>${ui.table(['Move', 'Why'], moveRows, 'mono')}</details>
         <div class="sub">2. Productions</div>
         <p>${r.prods.length} productions come out of the construction (one per pair of states for every push move). Only ${r.trimmed.prods.length} of them can take part in a derivation from the start variable <b class="mono">${esc(r.start)}</b>; the rest are removed as useless.</p>
         ${r.empty ? '<p><b>The start variable derives nothing, so the NPDA accepts no string.</b></p>' : `<div class="prods">${prodText}</div>`}
         <div class="sub">3. Strings generated</div>
         <div class="prods">${gen.list.map((x) => esc(x.join('') || EPS)).join(', ') || 'none'}</div>`);
      ui.put($('#cfgOut'), html);
      $('#cfgOut').closest('.board').scrollTop = 0;
    } catch (e) { showErr($('#pdaErr'), e.message); }
  }
  $('#pdaToCfg').addEventListener('click', runPdaToCfg);

  App.export({ lastCfgOp: () => lastCfgOp, runCFG: () => runCFG, runPDA: () => runPDA });
})(window.DT);
