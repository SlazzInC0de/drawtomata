/* Code generation tool. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, esc, $, $$, store, showErr, rerenders, stage, chip, blank, emptyState } = App;
  // CODE GENERATION
  const CG = DT.codegen;
  let lastCgOp = 'tac';
  const cgListing = (ins, T, mark) => `<div class="prods">${ins.map((x, i) => `<span class="v">${mark ? mark(i) : ''}(${i + 1})</span> ${esc(CG.insStr(x, T))}`).join('\n') || '<span class="muted">empty</span>'}</div>`;
  const labelListing = (ins) => {
    const { name, T } = CG.labelNames(ins);
    const w = Math.max(0, ...[...name.values()].map((l) => l.length + 1));
    return `<div class="prods">${ins.map((x, i) => `<span class="v">${(name.has(i) ? name.get(i) + ':' : '').padEnd(w)}</span> ${esc(CG.insStr(x, T))}`).join('\n')}${name.has(ins.length) ? `\n<span class="v">EXIT:</span>` : ''}</div>`;
  };
  const machListing = (code) => `<div class="prods">${code.map((m) => (m.op === 'LABEL' ? `<span class="v">${esc(m.L)}:</span>` : `    ${esc(CG.mStr(m))}`)).join('\n')}</div>`;
  const setText = (S) => esc(`{${[...S].sort().join(', ')}}`);
  const eqChip = (r, what) => (r.ok ? App.okChip(`${what} on ${r.runs} random inputs`) : App.badChip(`differs in ${r.what} (input set ${r.seed})`));
  function flowGraph(bb, lines, opts = {}) {
    const B = bb.blocks;
    const nodes = [{ id: 'entry', label: 'ENTRY', shape: 'plaintext' }, ...B.map((b) => ({ id: b.id, label: 'B' + (b.id + 1), lines: lines(b), cls: opts.cls ? opts.cls(b) : '' })), { id: 'exit', label: 'EXIT', shape: 'plaintext' }];
    const edges = [{ from: 'entry', to: 0, label: '' }];
    for (const b of B) for (const s of b.succ) edges.push({ from: b.id, to: s === bb.EXIT ? 'exit' : s, label: '', cls: opts.back && opts.back.has(b.id + '>' + s) ? 'back' : '' });
    return { nodes, edges, rankdir: 'TB' };
  }
  function dagGraph(dag, gen) {
    const reassigned = new Set();
    dag.nodes.forEach((o) => o.kind === 'op' && o.ids.forEach((v) => reassigned.add(v)));
    dag.cur.forEach((id, v) => { if (dag.nodes[id].kind !== 'leaf' || dag.nodes[id].label !== v) reassigned.add(v); });
    const nodes = dag.nodes.filter((o) => !(o.kind === 'leaf' && dag.nodes.every((p) => !(p.kids || []).includes(o.id)) && !o.ids.length)).map((o) => ({
      id: o.id,
      label: o.kind === 'op' ? (o.op === 'minus' ? '−' : o.op) : o.kind === 'leaf' && reassigned.has(o.label) ? o.label + '₀' : o.label,
      shape: o.kind === 'op' ? 'circle' : 'plaintext',
      xlabel: o.ids.filter((v) => !gen.has(v)).join(', '),
      cls: o.killed ? 'dead' : ''
    }));
    const edges = [];
    dag.nodes.forEach((o) => (o.kids || []).forEach((k) => edges.push({ from: o.id, to: k, label: '' })));
    return { nodes, edges, rankdir: 'TB', ordering: true };
  }
  const nodeLabel = (o) => (o.kind === 'op' ? o.op : o.kind === 'const' ? o.label : `leaf ${o.label}`);

  function cgTAC(prog) {
    const r = CG.representations(prog);
    const hasJump = prog.ins.some(CG.isJump);
    const qRows = r.quads.map((q, i) => [String(i), ...q.map(esc)]);
    const tRows = r.triples.map((t, i) => [`(${i})`, ...(hasJump ? t : t.slice(0, 3)).map(esc)]);
    const tHead = ['#', 'op', 'arg1', 'arg2', ...(hasJump ? ['jump to'] : [])];
    return stage('cg-tac', '', 'Three-address code', chip('instructions', prog.ins.length) + chip('triples', r.triples.length),
      `${prog.lowered ? `<p>Every operator gets its own instruction with at most three addresses, and each intermediate result goes into a new temporary (${[...prog.gen].map(esc).join(', ')}), in the order the expression is evaluated.</p>` : '<p>The program is already in three-address form.</p>'}
       ${cgListing(prog.ins)}
       <div class="sub">Quadruples</div>
       <p class="small muted">op, arg1, arg2, result. Temporaries are named, so instructions can be moved freely.</p>
       ${App.grid(['#', 'op', 'arg1', 'arg2', 'result'], qRows)}
       <div class="sub">Triples</div>
       <p class="small muted">No result field: a result is referred to by the number of the triple that computes it, written (k).</p>
       ${App.grid(tHead, tRows)}
       <div class="sub">Indirect triples</div>
       <p class="small muted">A separate list of pointers to triples. An optimizer can reorder this list without renumbering the triples.</p>
       <div class="cols"><div>${App.grid(['Instruction', 'Triple'], r.indirect.map((n, i) => [String(n), `(${i})`]))}</div><div>${App.grid(tHead, tRows)}</div></div>`);
  }

  function cgDAG(prog) {
    const o = CG.optimize(prog);
    let html = '';
    o.per.forEach((p, k) => {
      const dag = p.dag;
      const rows = dag.nodes.map((n) => [String(n.id), esc(nodeLabel(n)), (n.kids || []).map(String).join(', ') || '—', esc(n.ids.filter((v) => !prog.gen.has(v)).join(', ')) || '—']);
      const steps = dag.steps.map((s) => `<li><b class="mono">${esc(s.text)}</b>: ${esc(s.note)}</li>`).join('');
      const cse = dag.steps.filter((s) => s.kind === 'cse').length;
      html += stage('cg-dag' + k, o.bb.blocks.length > 1 ? String(k + 1) : '', o.bb.blocks.length > 1 ? `DAG for block B${k + 1}` : 'DAG by the value-number method', chip('nodes', dag.nodes.length) + (cse ? chip('common subexpressions', cse) : ''),
        `<div class="formula" style="white-space:normal">For x = y op z: look up (op, node(y), node(z)) in the table. If it is there, reuse that node; if not, make a new one. Then attach x to it and take x off its old node.</div>
         <ol class="steps" style="font-family:inherit;font-size:14px">${steps}</ol>
         <div class="cols"><div><div class="sub">Value-number table</div>${App.grid(['#', 'Node', 'Children', 'Names attached'], rows)}</div>
         <div><div class="sub">DAG</div>${ui.slot(dagGraph(dag, prog.gen))}<p class="small muted">Names beside a node hold its value at the end of the block. A leaf like b₀ is the value b had on entry.</p></div></div>
         <div class="sub">Code rebuilt from the DAG</div>
         <p class="small muted">One instruction per interior node that is needed; names not live after the block are dropped. Live on exit: ${setText(p.liveOut)}.</p>
         ${cgListing(p.code.length ? p.code : [], CG.blockTarget(o.bb))}`);
    });
    const chk = CG.equivalent(prog.ins, o.ins, { names: CG.observedOf(prog) });
    return html.replace('</section>', `<p>${eqChip(chk, 'rebuilt code gives the same results')}</p></section>`);
  }

  function cgSSA(prog) {
    const s = CG.toSSA(prog);
    const T = CG.blockTarget(s.bb);
    const chk = CG.checkSSA(prog, s);
    const meta = (s.single ? App.okChip('every name is assigned exactly once') : App.badChip('a name is assigned twice')) + eqChip(chk, 'same results');
    const all = (b) => [...b.phis, ...b.ins];
    const phiStr = (p) => `${p.dst} = φ(${p.args.map((a) => a.name).join(', ')})`;
    const renamed = [...s.rename].sort();
    const intro = `<p>Each assignment to a name that is assigned more than once gets a new version (${renamed.length ? renamed.map((v) => esc(v) + '₁, ' + esc(v) + '₂, …').join('; ') : 'none needed here'}), and every use refers to the version that reaches it. Names assigned only once keep their name.</p>`;
    if (s.bb.blocks.length === 1) {
      return stage('cg-ssa', '', 'Static single-assignment form', meta, `${intro}<div class="cols"><div><div class="sub">Three-address code</div>${cgListing(prog.ins)}</div><div><div class="sub">SSA</div>${cgListing(s.blocks[0].ins)}</div></div>`);
    }
    const D = s.D;
    const bn = (i) => (i === s.ENTRY ? 'ENTRY' : 'B' + (i + 1));
    const domRows = s.bb.blocks.map((b, i) => [bn(i), D.reach.has(i) ? esc([...D.dom[i]].filter((d) => d !== s.ENTRY).sort((a, c) => a - c).map(bn).join(', ')) : 'unreachable', D.idom[i] === null ? '—' : bn(D.idom[i]), esc([...s.DF[i]].map(bn).join(', ')) || '∅']);
    const phiNotes = s.blocks.flatMap((b, i) => b.phis.map((p) => `<li>${esc(p.v)} is assigned in a block whose dominance frontier contains ${bn(i)}, and ${esc(p.v)} is live entering ${bn(i)}: <b class="mono">${esc(phiStr(p))}</b>, one argument per predecessor (${p.args.map((a) => bn(a.from)).join(', ')})</li>`)).join('');
    const g = flowGraph(s.bb, (b) => all(s.blocks[b.id]).map((x) => (x.k === 'phi' ? phiStr(x) : CG.insStr(x, T))));
    return stage('cg-ssa', '', 'Static single-assignment form', meta + chip('φ-functions', s.phiCount),
      `${intro}
       <div class="formula" style="white-space:normal">Where two paths with different versions meet, a φ-function picks the version for the path actually taken. φ goes at the dominance frontier of every block that assigns the name (pruned: only where the name is still live).</div>
       <div class="sub">1. Dominators and dominance frontiers</div>
       ${App.grid(['Block', 'Dominators', 'Immediate dominator', 'Dominance frontier'], domRows)}
       <div class="sub">2. Place φ-functions</div>
       ${phiNotes ? `<ul class="steps" style="font-family:inherit;font-size:14px">${phiNotes}</ul>` : '<p>No name needs a φ-function: no assignment reaches a join point where the name is still live.</p>'}
       <div class="sub">3. Rename, walking the dominator tree</div>
       <div class="cols"><div>${s.blocks.map((b, i) => `<div class="sub">${bn(i)}</div><div class="prods">${all(b).map((x) => esc(x.k === 'phi' ? phiStr(x) : CG.insStr(x, T))).join('\n') || ' '}</div>`).join('')}</div>
       <div>${ui.slot(g)}</div></div>`);
  }

  function cgBlocks(prog) {
    const bb = CG.basicBlocks(prog.ins);
    const D = CG.dominators(bb);
    const T = CG.blockTarget(bb);
    const lead = new Set(bb.leaders);
    const rows = prog.ins.map((x, i) => [lead.has(i) ? `<b>(${i + 1})</b>` : `(${i + 1})`, esc(CG.insStr(x)), lead.has(i) ? `<b>B${bb.blockOf[i] + 1}</b>` : `B${bb.blockOf[i] + 1}`, lead.has(i) ? esc(bb.why.get(i).join('; ')) : '']);
    const back = new Set(D.loops.map((l) => l.from + '>' + l.head));
    const g = flowGraph(bb, (b) => b.ins.map((x) => CG.insStr(x, T)), { back });
    const bn = (i) => (i === bb.EXIT ? 'EXIT' : 'B' + (i + 1));
    const edgeRows = bb.blocks.map((b) => [bn(b.id), `(${b.start + 1}) – (${b.end})`, esc(b.pred.map(bn).join(', ') || (b.id === 0 ? 'ENTRY' : '—')) + (b.id === 0 && b.pred.length ? ', ENTRY' : ''), esc(b.succ.map(bn).join(', '))]);
    const loops = D.loops.map((l) => `<li>Back edge ${bn(l.from)} → ${bn(l.head)} (${bn(l.head)} dominates ${bn(l.from)}). Natural loop: {${l.body.map(bn).join(', ')}}, header ${bn(l.head)}.</li>`).join('');
    const domRows = bb.blocks.map((b, i) => [bn(i), D.reach.has(i) ? esc([...D.dom[i]].filter((d) => d !== D.ENTRY).sort((a, c) => a - c).map(bn).join(', ')) : 'unreachable']);
    return stage('cg-bb', '1', 'Leaders and basic blocks', chip('leaders', bb.leaders.length) + chip('blocks', bb.blocks.length),
      `<div class="formula" style="white-space:normal">A leader is (1) the first instruction, (2) any target of a jump, (3) any instruction right after a jump. A block runs from a leader up to, not including, the next leader.</div>
       ${App.grid(['#', 'Instruction', 'Block', 'Leader because'], rows)}`)
      + stage('cg-fg', '2', 'Flow graph', chip('edges', bb.blocks.reduce((s, b) => s + b.succ.length, 0)),
        `<p>An edge B → C when C can run right after B: B ends in a jump to C, or C follows B and B does not end in an unconditional jump.</p>
         <div class="cols"><div>${App.grid(['Block', 'Instructions', 'Predecessors', 'Successors'], edgeRows)}</div><div>${ui.slot(g)}</div></div>`)
      + stage('cg-loops', '3', 'Loops', chip('loops', D.loops.length),
        `<p>D dominates B when every path from ENTRY to B goes through D. An edge B → H is a back edge when H dominates B, and its natural loop is H plus every block that can reach B without passing through H.</p>
         <div class="cols"><div>${App.grid(['Block', 'Dominators'], domRows)}</div><div>${loops ? `<ul class="steps" style="font-family:inherit;font-size:14px">${loops}</ul>` : '<p>No back edges, so the flow graph has no loops.</p>'}${D.loops.length ? '<p class="small muted">Back edges are dashed in the flow graph.</p>' : ''}</div></div>`);
  }

  function cgLive(prog) {
    const bb = CG.basicBlocks(prog.ins);
    const exitLive = new Set(CG.observedOf(prog));
    const lv = CG.liveness(bb, exitLive);
    const bn = (i) => 'B' + (i + 1);
    const rows = bb.blocks.map((b, i) => [bn(i), setText(lv.use[i]), setText(lv.def[i]), setText(lv.IN[i]), setText(lv.OUT[i])]);
    const passRows = lv.passes.flatMap((p, k) => bb.blocks.map((b, i) => [i === 0 ? `pass ${k + 1}` : '', bn(i), setText(p.IN[i]), setText(p.OUT[i])]));
    let html = stage('cg-live', '1', 'Live variables (data flow)', chip('passes', lv.passes.length),
      `<div class="formula">OUT[B] = ∪ IN[S] over successors S · IN[B] = use[B] ∪ (OUT[B] − def[B]) · at EXIT: ${setText(exitLive)}</div>
       <p class="small muted">use[B]: names read in B before any assignment in B. def[B]: names assigned in B. The blocks are visited from last to first until nothing changes.</p>
       ${App.grid(['Block', 'use', 'def', 'IN', 'OUT'], rows)}
       <details><summary>Pass by pass</summary>${App.grid(['', 'Block', 'IN', 'OUT'], passRows)}<p class="small muted">The last pass changed nothing, so the sets are final.</p></details>`);
    bb.blocks.forEach((b, k) => {
      const nu = CG.nextUse(b.ins, lv.OUT[k], b.start);
      const st = (s) => (!s ? '' : s.live ? (s.next === null ? 'live on exit' : `next use (${s.next + 1})`) : 'dead');
      const tr = b.ins.map((x, j) => {
        const info = nu.rows[j];
        const d = CG.defOf(x);
        const cells = Object.entries(info).map(([v, s]) => `${esc(v)}: ${st(s)}`);
        const then = [d && !CG.usesOf(x).includes(d) ? `${d}: dead` : null, ...CG.usesOf(x).map((u) => `${u}: next use (${b.start + j + 1})`)].filter(Boolean);
        return [`(${b.start + j + 1})`, esc(CG.insStr(x, CG.blockTarget(bb))), esc(cells.join(' · ')) || '—', esc(then.join(' · '))];
      });
      html += stage('cg-nu' + k, '', `Next-use information in B${k + 1}`, chip('live on exit', setText(lv.OUT[k])),
        `<p>Scan from the last instruction up. At each x = y op z: first attach the current information about x, y and z to the instruction, then set x to dead (no next use) and y, z to live with next use here.</p>
         ${App.grid(['#', 'Instruction', 'Attached to the instruction', 'Then set'], tr.reverse())}
         <p class="small muted">Rows are in scan order (last instruction first). The attached column is what the code generator reads.</p>`);
    });
    return html;
  }

  function cgOpt(prog) {
    const o = CG.optimize(prog);
    const T = CG.blockTarget(o.bb);
    const chk = CG.equivalent(prog.ins, o.ins, { names: CG.observedOf(prog) });
    let html = stage('cg-opt', '', 'Optimize each block with its DAG', chip('instructions', `${prog.ins.length} → ${o.ins.length}`) + eqChip(chk, 'same results'),
      `<p>Build the DAG of each block (common subexpressions share a node, constants are folded, x + 0 and x * 1 collapse), then write one instruction per node that is still needed. A name that is not live at the end of the block is not stored: that removes dead code.</p>
       <div class="cols"><div><div class="sub">Before</div>${labelListing(prog.ins)}</div><div><div class="sub">After</div>${labelListing(o.ins)}</div></div>`);
    o.per.forEach((p, k) => {
      const notes = p.dag.steps.filter((s) => ['cse', 'fold', 'identity'].includes(s.kind)).map((s) => `<li><b class="mono">${esc(s.text)}</b>: ${esc(s.note)}</li>`);
      p.dropped.filter((v) => !prog.gen.has(v)).forEach((v) => notes.push(`<li>${esc(v)} is not live after B${k + 1}, so its value is never stored: dead code.</li>`));
      html += stage('cg-opt' + k, String(k + 1), `Block B${k + 1}`, chip('live on exit', setText(p.liveOut)) + chip('instructions', `${p.before.length} → ${p.code.length}`),
        `<div class="cols"><div>${cgListing(p.before, T)}</div><div>${cgListing(p.code, T)}</div></div>
         ${notes.length ? `<ul class="steps" style="font-family:inherit;font-size:14px">${notes.join('')}</ul>` : '<p class="small muted">Nothing to improve in this block.</p>'}
         <details><summary>DAG</summary>${ui.slot(dagGraph(p.dag, prog.gen))}</details>`);
    });
    return html;
  }

  function cgGen(prog) {
    const n = +$('#cgRegs').value || 3;
    const g = CG.generate(prog, n);
    const chk = CG.checkMachine(prog.ins, g.code, 40, CG.observedOf(prog));
    const T = CG.blockTarget(g.bb);
    const rows = [];
    let lastB = -1;
    for (const r of g.rows) {
      if (r.block !== lastB) { lastB = r.block; rows.push([{ v: `<b>B${r.block + 1}</b>`, cls: 'sep' }, '', '', '', '']); }
      const L = (v) => ({ v, cls: 'l' });
      rows.push([L(esc(CG.insStr(r.x, T))), L(r.code.map((m) => esc(CG.mStr(m)) + (m.why ? ` <span class="muted">(${esc(m.why)})</span>` : '')).join('<br>') || '<span class="muted">none</span>'), String(r.cost), L(r.regs.map(esc).join('<br>')), L(r.addr.map(esc).join('<br>') || '—')]);
    }
    return stage('cg-gen', '', 'Simple code generator', chip('registers', g.nRegs) + chip('total cost', g.total) + (chk.ok ? App.okChip(`machine gives the same results on ${chk.runs} random inputs`) : App.badChip(`machine differs in ${chk.what}`)),
      `<div class="formula" style="white-space:normal">Cost of an instruction = 1 + 1 for each operand that is a memory name, a constant (#c), an indexed address a(R) or a label. LD R0, a costs 2; ADD R0, R0, R1 costs 1; ST a, R0 costs 2.</div>
       <p>For x = y op z, getReg picks registers for y and z (one that already holds them, else an empty one, else one whose contents are safe to lose, spilling the rest). Rx can reuse Ry when y is dead after this instruction. The register descriptor says what each register holds; the address descriptor says where the current value of each name lives. At the end of a block every live name that is only in a register is stored.</p>
       ${App.grid(['Three-address', 'Target code', 'Cost', 'Register descriptor', 'Address descriptor'], rows)}
       <details><summary>The whole program</summary>${machListing(g.code)}</details>`);
  }

  function cgPeep(prog) {
    const r = CG.peephole(prog);
    const names = CG.observedOf(prog);
    const c1 = CG.equivalent(prog.ins, r.tac.ins, { names });
    const c2 = CG.checkMachine(prog.ins, r.after.code, 40, names);
    const logList = (log) => (log.length ? `<ol class="steps" style="font-family:inherit;font-size:14px">${log.map((l) => `<li><b>${esc(l.rule)}</b>: <span class="mono">${esc(l.text)}</span></li>`).join('')}</ol>` : '<p class="small muted">No pattern applies.</p>');
    return stage('cg-peep1', '1', 'Peephole on three-address code', chip('instructions', `${prog.ins.length} → ${r.tac.ins.length}`) + eqChip(c1, 'same results'),
      `<p>Slide a small window over the code and replace patterns with shorter or cheaper ones, repeating until nothing changes. Instruction numbers in the log are those of the code at that moment.</p>
       ${logList(r.tac.log)}
       <div class="cols"><div><div class="sub">Before</div>${labelListing(prog.ins)}</div><div><div class="sub">After</div>${labelListing(r.tac.ins)}</div></div>`)
      + stage('cg-peep2', '2', 'Peephole on target code', chip('cost', `${r.costBefore} → ${r.costAfter}`) + (c2.ok ? App.okChip(`same results on ${c2.runs} random inputs`) : App.badChip(`differs in ${c2.what}`)),
        `<p>Left: the naive code for the original program, where every instruction loads its operands and stores its result. Right: the code for the improved program after removing loads of a value a register already holds, stores of a value memory already has, and using the INC idiom. A label resets what is known about the registers, since control can arrive from elsewhere.</p>
         ${logList(r.after.log)}
         <div class="cols"><div><div class="sub">Before (cost ${r.costBefore})</div>${machListing(r.before)}</div><div><div class="sub">After (cost ${r.costAfter})</div>${machListing(r.after.code)}</div></div>`);
  }

  function runCG(op) {
    lastCgOp = op || lastCgOp;
    $$('[data-cg]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cg === lastCgOp)));
    showErr($('#cgErr'), '');
    if (blank('#cgIn')) { store.set('cg', ''); emptyState($('#cgOut'), 'Type an expression or a short program', 'Assignments such as a = b * -c + b * -c, or three-address code with labels and gotos.', 'cg'); return; }
    let prog;
    try {
      prog = CG.parseProgram($('#cgIn').value);
      const live = $('#cgLive').value.split(/[\s,{}]+/).filter(Boolean);
      if (live.length) prog.liveExit = live;
    } catch (e) { showErr($('#cgErr'), e.message); return; }
    store.set('cg', $('#cgIn').value); store.set('cglive', $('#cgLive').value);
    const bb = CG.basicBlocks(prog.ins);
    let html = `<div class="summary">${chip('instructions', prog.ins.length)}${chip('blocks', bb.blocks.length)}${chip('live on exit', setText(new Set(CG.observedOf(prog))))}</div>`;
    try {
      const o = lastCgOp;
      if (o === 'tac') html += cgTAC(prog);
      else if (o === 'dag') html += cgDAG(prog);
      else if (o === 'ssa') html += cgSSA(prog);
      else if (o === 'bb') html += cgBlocks(prog);
      else if (o === 'live') html += cgLive(prog);
      else if (o === 'opt') html += cgOpt(prog);
      else if (o === 'gen') html += cgGen(prog);
      else if (o === 'peep') html += cgPeep(prog);
    } catch (e) { showErr($('#cgErr'), e.message); return; }
    ui.put($('#cgOut'), html);
  }
  rerenders.cg = () => runCG();
  $$('[data-cg]').forEach((b) => b.addEventListener('click', () => runCG(b.dataset.cg)));
  ['#cgLive', '#cgRegs'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') runCG(); }));
  $('#cgRegs').addEventListener('change', () => { if (lastCgOp === 'gen') runCG(); });

  App.export({ runCG: () => runCG });
})(window.DT);
