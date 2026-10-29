/* Learning mode: step-by-step reveal of an algorithm's table, with the rule behind each step.
   The step builders are pure (tested in Node); the player below only runs in the browser. */
(function (DT) {
  'use strict';
  const EPS = 'λ';
  const setStr = (L, S) => (S.length ? '{' + S.map((q) => L[q]).join(', ') + '}' : '∅');
  const sorted = (s) => [...s].sort((a, b) => a - b);
  const allCols = (r, w) => Array.from({ length: w }, (_, c) => [r, c]);

  // NFA → DFA: one step per (DFA state, symbol), in the order the algorithm visits them.
  function subsetSteps(src, sb) {
    const FA = DT.fa, d = FA.delta(src), L = src.labels, dfa = sb.fa, A = sb.alphabet;
    const T = new Map(dfa.trans.map((t) => [t.from + '|' + t.sym, t.to]));
    const name = (i) => dfa.labels[i];
    const head = ['DFA state', 'set of NFA states', ...A];
    const rows = sb.sets.map((S, i) => [(i === dfa.start ? '→' : '') + (dfa.finals.has(i) ? '*' : '') + name(i), setStr(L, S), ...A.map((a) => name(T.get(i + '|' + a)))]);
    const steps = [{ cells: [[0, 0], [0, 1]], text: `Start with the λ-closure of the NFA start state: λ-closure({${L[src.start]}}) = ${setStr(L, sb.sets[0])}. Call it ${name(0)}. It is the DFA start state.` }];
    let seen = 1;
    for (let i = 0; i < sb.sets.length; i++) {
      for (let k = 0; k < A.length; k++) {
        const a = A[k], to = T.get(i + '|' + a);
        const mv = sorted(FA.move(d, sb.sets[i], a));
        const cells = [[i, 2 + k]];
        let text = `Mark ${name(i)}. move(${name(i)}, ${a}) = ${setStr(L, mv)}`;
        text += mv.length ? `, and its λ-closure is ${setStr(L, sb.sets[to])}.` : '.';
        if (to >= seen) {
          seen = to + 1;
          cells.push([to, 0], [to, 1]);
          text += sb.sets[to].length ? ` This set is new, so it becomes state ${name(to)}.` : ' The empty set becomes the trap state ∅.';
        } else text += ` That set is already state ${name(to)}.`;
        steps.push({ cells, text });
      }
    }
    const fin = sorted(dfa.finals).map(name);
    steps.push({ cells: [], text: `Every state is marked, so stop. Final states are the sets that contain an NFA final state: ${fin.length ? fin.join(', ') : 'none'}.` });
    return { head, rows, always: [], steps };
  }

  // Table-filling minimization: pass 0, then one step per pair marked in later passes, then the merge.
  function minimizeSteps(m) {
    const L = m.labels, n = m.dfa.n;
    const head = ['', ...L.slice(0, n - 1)];
    const rows = [], always = [], eqCells = [];
    for (let i = 1; i < n; i++) {
      const row = [L[i]];
      always.push([i - 1, 0]);
      for (let j = 0; j < n - 1; j++) {
        if (j >= i) { row.push(''); always.push([i - 1, j + 1]); continue; }
        const mk = m.mark[i][j];
        row.push(mk ? '×' + mk.pass : '=');
        if (!mk) eqCells.push([i - 1, j + 1]);
      }
      rows.push(row);
    }
    const cell = (x) => { const i = Math.max(x.i, x.j), j = Math.min(x.i, x.j); return [i - 1, j + 1]; };
    const pair = (i, j) => `(${L[Math.max(i, j)]}, ${L[Math.min(i, j)]})`;
    const steps = [{ cells: [], text: 'Write every pair of states once (the lower triangle). A pair gets × when the two states are distinguishable.' }];
    const p0 = m.passes[0] || [];
    steps.push({ cells: p0.map(cell), text: p0.length ? `Pass 0: a final and a non-final state are always distinguishable (λ tells them apart). Mark ${p0.map((x) => pair(x.i, x.j)).join(', ')}.` : 'Pass 0: all states are final or all are non-final, so nothing is marked.' });
    for (let k = 1; k < m.passes.length; k++) {
      for (const x of m.passes[k]) {
        steps.push({ cells: [cell(x)], text: `Pass ${k}: on ${x.a}, ${L[x.i]} goes to ${L[x.to[0]]} and ${L[x.j]} goes to ${L[x.to[1]]}. ${pair(x.to[0], x.to[1])} is already marked, so ${pair(x.i, x.j)} is distinguishable: mark it.` });
      }
    }
    const merged = m.groups.filter((g) => g.length > 1).map((g) => '{' + g.map((q) => L[q]).join(', ') + '}');
    steps.push({ cells: eqCells, text: `Pass ${m.passes.length} marks nothing new, so stop. Unmarked pairs are equivalent. ${merged.length ? 'Merge ' + merged.join(', ') + '.' : 'No pair is unmarked, so the DFA is already minimal.'}` });
    return { head, rows, always, steps };
  }

  // Predictive (LL(1)) parse: one step per row of the trace.
  function llSteps(G, r) {
    const head = ['Matched', 'Stack', 'Input', 'Action'];
    const rows = r.rows.map((x) => [x.matched, x.stack.join(' '), x.input.join(' '), x.action]);
    const steps = r.rows.map((x, i) => {
      const X = x.stack[x.stack.length - 1], a = x.input[0];
      let text;
      if (x.action === 'accept') text = 'The stack holds only $ and the input is $, so the string is accepted.';
      else if (x.action.startsWith('match')) text = `The top of the stack is the terminal ${X} and the lookahead is ${a}. They match, so pop ${X} and advance the input.`;
      else if (x.action.startsWith('output')) {
        const prod = x.action.replace(/^output /, '').replace(/ \(conflict.*$/, '');
        const rhs = prod.split('→')[1].trim();
        text = `The top is the nonterminal ${X} and the lookahead is ${a}. M[${X}, ${a}] = ${prod}, so pop ${X} and push ${rhs === EPS || rhs === 'ε' ? 'nothing (it derives the empty string)' : rhs.includes(' ') ? rhs + ' with ' + rhs.split(' ')[0] + ' on top' : rhs}.`;
      } else text = `${x.action.replace(/^error: /, 'Error: ')}. The parser cannot continue, so the string is rejected.`;
      return { cells: allCols(i, head.length), text };
    });
    return { head, rows, always: [], steps, trace: true };
  }

  // LR parse (LR(0)/SLR/CLR/LALR tables share the same driver): one step per row.
  function lrSteps(GA, r) {
    const head = ['Stack', 'Input', 'Action', 'Handle'];
    const rows = r.rows.map((x) => [x.stack, x.input.join(' '), x.action, x.handle || '']);
    const steps = r.rows.map((x, i) => {
      const parts = x.stack.split(' '), s = parts[parts.length - 1], a = x.input[0];
      let text;
      if (x.action === 'accept') text = `ACTION[${s}, $] = accept: the whole input has been reduced to the start symbol.`;
      else if (x.action.startsWith('shift')) { const t = x.action.split(' ')[1]; text = `The state on top is ${s} and the lookahead is ${a}. ACTION[${s}, ${a}] = shift ${t}: push ${a} and then state ${t}.`; }
      else if (x.action.startsWith('reduce')) {
        const prod = x.action.replace(/^reduce by /, '').replace(/ \(conflict.*$/, '');
        const [lhs] = prod.split('→').map((z) => z.trim());
        const next = r.rows[i + 1] ? r.rows[i + 1].stack.split(' ') : null;
        const g = next ? next[next.length - 1] : '?';
        const below = next ? next[next.length - 3] : '?';
        text = `ACTION[${s}, ${a}] = reduce by ${prod}. The handle ${x.handle || EPS} is on top: pop it with its states, uncovering state ${below}. GOTO[${below}, ${lhs}] = ${g}, so push ${lhs} and ${g}.`;
      } else text = `${x.action.replace(/^error: /, 'Error: ')}. No move is possible, so the string is rejected.`;
      return { cells: allCols(i, head.length), text };
    });
    return { head, rows, always: [], steps, trace: true };
  }

  DT.learn = { subsetSteps, minimizeSteps, llSteps, lrSteps };

  if (typeof document === 'undefined') return;

  // ---------- player ----------
  const specs = new Map();
  let nextId = 0, timer = null;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = (s) => (DT.ui && DT.ui.D ? DT.ui.D(s) : s);

  // Returns the button that opens the player; the player is drawn in place when it is pressed.
  DT.learn.button = (spec, label = 'Learn step by step') => {
    if (!spec || !spec.steps.length) return '';
    const id = 'learn' + ++nextId;
    specs.set(id, { ...spec, k: 0 });
    return `<div class="learn" id="${id}"><button type="button" class="ghost learnOpen" data-learn="${id}">▶ ${esc(label)}</button></div>`;
  };

  function draw(id) {
    const el = document.getElementById(id), sp = specs.get(id);
    if (!el || !sp) return;
    const key = (r, c) => r + ',' + c;
    const shown = new Set(sp.always.map(([r, c]) => key(r, c)));
    for (let k = 0; k <= sp.k; k++) for (const [r, c] of sp.steps[k].cells) shown.add(key(r, c));
    const now = new Set(sp.steps[sp.k].cells.map(([r, c]) => key(r, c)));
    const rowVisible = (r) => sp.rows[r].some((_, c) => shown.has(key(r, c)));
    const body = sp.rows.map((row, r) => (rowVisible(r)
      ? `<tr${sp.trace && r === sp.k ? ' class="cur"' : ''}>${row.map((v, c) => `<td class="${now.has(key(r, c)) && !sp.trace ? 'hl' : ''}${shown.has(key(r, c)) ? '' : ' wait'}">${shown.has(key(r, c)) ? esc(D(v)) : ''}</td>`).join('')}</tr>`
      : '')).join('');
    const n = sp.steps.length;
    const html = `<div class="learnBar">
        <button type="button" class="iconBtn" data-lstep="first" aria-label="First step"${sp.k === 0 ? ' disabled' : ''}>⏮</button>
        <button type="button" class="iconBtn" data-lstep="prev" aria-label="Previous step"${sp.k === 0 ? ' disabled' : ''}>◀</button>
        <span class="learnPos">Step ${sp.k + 1} of ${n}</span>
        <button type="button" class="iconBtn" data-lstep="next" aria-label="Next step"${sp.k === n - 1 ? ' disabled' : ''}>▶</button>
        <button type="button" class="iconBtn" data-lstep="last" aria-label="Last step"${sp.k === n - 1 ? ' disabled' : ''}>⏭</button>
        <button type="button" class="ghost" data-lstep="play">${timer && timer.id === id ? 'Pause' : 'Play'}</button>
        <button type="button" class="ghost" data-lstep="close">Close</button>
      </div>
      <p class="learnText" aria-live="polite">${esc(D(sp.steps[sp.k].text))}</p>
      <div class="tbl"><table class="mono learnTable${sp.trace ? ' trace' : ''}"><thead><tr>${sp.head.map((h) => `<th>${esc(D(h))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
    el.innerHTML = DOMPurify.sanitize(html);
    el.classList.add('open');
  }
  const stop = () => { if (timer) { clearInterval(timer.h); timer = null; } };
  const go = (id, how) => {
    const sp = specs.get(id);
    if (!sp) return;
    const n = sp.steps.length;
    if (how === 'close') { stop(); const el = document.getElementById(id); el.classList.remove('open'); el.innerHTML = `<button type="button" class="ghost learnOpen" data-learn="${id}">▶ Learn step by step</button>`; return; }
    if (how === 'play') {
      if (timer && timer.id === id) { stop(); draw(id); return; }
      stop();
      if (sp.k === n - 1) sp.k = 0;
      timer = { id, h: setInterval(() => { if (!document.getElementById(id) || sp.k >= n - 1) { stop(); draw(id); return; } sp.k++; draw(id); }, 1400) };
      draw(id); return;
    }
    stop();
    sp.k = how === 'first' ? 0 : how === 'last' ? n - 1 : how === 'prev' ? Math.max(0, sp.k - 1) : Math.min(n - 1, sp.k + 1);
    draw(id);
  };
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-learn]');
    if (o) { const sp = specs.get(o.dataset.learn); if (sp) { sp.k = 0; draw(o.dataset.learn); } return; }
    const b = e.target.closest('[data-lstep]');
    if (b) go(b.closest('.learn').id, b.dataset.lstep);
  });
  document.addEventListener('keydown', (e) => {
    const box = e.target.closest && e.target.closest('.learn.open');
    if (!box) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(box.id, 'next'); (box.querySelector('[data-lstep="next"]:not([disabled])') || box.querySelector('[data-lstep="prev"]')).focus(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(box.id, 'prev'); (box.querySelector('[data-lstep="prev"]:not([disabled])') || box.querySelector('[data-lstep="next"]')).focus(); }
  });
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
