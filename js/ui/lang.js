/* Language → DFA tool. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, FA, esc, $, showErr, loadBtn, rerenders, stage, chip, hideFor, sigmaStr, minimizeHTML, regexHTML } = App;
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
      <label class="small muted cf" data-f="w">w <input class="cW mono"></label>
      <label class="small muted cf" data-f="x">x <input class="cX mono" maxlength="1"></label>
      <label class="small muted cf" data-f="cmp"><select class="cCmp"><option value="eq">=</option><option value="ge">≥</option><option value="le">≤</option></select></label>
      <label class="small muted cf" data-f="k">k <input class="cK mono" type="number" min="0" max="12"></label>
      <label class="small muted cf" data-f="m">m <input class="cM mono" type="number" min="1" max="12"></label>
      <label class="small muted cf" data-f="r">r <input class="cR mono" type="number" min="0" max="11"></label>`;
    const sel = el.querySelector('.cType');
    sel.value = def.type;
    el.querySelector('.cW').value = def.w || 'ab';
    el.querySelector('.cX').value = def.x || 'b';
    el.querySelector('.cK').value = def.k || 2;
    el.querySelector('.cM').value = def.m || 2;
    el.querySelector('.cR').value = def.r || 0;
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
})(window.DT);
