/* Syntax-directed translation tool. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, EPS, esc, $, $$, store, showErr, rerenders, stage, chip, blank, emptyState } = App;
  // SYNTAX-DIRECTED TRANSLATION
  const SD = DT.sdt;
  let lastSdOp = 'tree';
  const dq = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const nodeName = (n) => (n.tok && n.tok.text !== n.sym ? `${n.sym} (${n.tok.text})` : n.sym);
  function sddTable(sdd) {
    const rows = sdd.prods.map((p) => [esc(SD.prodStr(p)), p.rules.map((r) => esc(r.text)).join('<br>') || '<span class="muted">none</span>']);
    return App.grid(['Production', 'Semantic rules'], rows.map((r) => r.map((v) => ({ v, cls: 'l' }))));
  }
  function attrsAt(res, n) {
    return [...res.inst.values()].filter((I) => I.node === n && !I.action).map((I) => `${I.attr} = ${res.show(I.value)}`);
  }
  function annotatedGraph(r) {
    const nodes = SD.preorder(r.root).map((n) => {
      const lines = r.res.error ? [] : attrsAt(r.res, n);
      if (n.tok && !lines.length) return { id: n.id, label: n.tok.text === n.sym ? n.sym : `${n.sym} ${n.tok.text}`, shape: 'plaintext' };
      if (n.tok) return { id: n.id, label: n.sym, lines: n.tok.text === n.sym || lines.length ? lines : [n.tok.text] };
      return lines.length ? { id: n.id, label: n.sym, lines } : { id: n.id, label: n.sym, shape: 'plaintext' };
    });
    const edges = [];
    SD.preorder(r.root).forEach((n) => (n.kids || []).forEach((c) => edges.push({ from: n.id, to: c.id, label: '' })));
    SD.preorder(r.root).forEach((n) => { if (!n.tok && n.kids && !n.kids.length) { nodes.push({ id: 'e' + n.id, label: EPS, shape: 'plaintext' }); edges.push({ from: n.id, to: 'e' + n.id, label: '' }); } });
    return { nodes, edges, rankdir: 'TB', ordering: true };
  }
  // dependency graph: one dashed box per parse-tree node holding its attribute instances
  function dependencyGraph(r) {
    const res = r.res;
    const num = new Map(res.order.map((k, i) => [k, i + 1]));
    const all = SD.preorder(r.root);
    const anchor = new Map();
    let dot = 'digraph D{rankdir=TB;compound=true;bgcolor="transparent";pad=0.15;nodesep=0.22;ranksep=0.42;newrank=true;';
    dot += 'node[fontname="JetBrains Mono",fontsize=11,shape=ellipse,height=0.32,margin="0.06,0.02"];edge[arrowsize=0.6];';
    const plain = { nodes: [], edges: [] };
    const instDot = (I) => {
      const k = num.get(I.key);
      plain.nodes.push({ id: I.key, label: `${k}: ${I.attr}` });
      return `a${I.key.replace('.', '_')}[label=${dq(`${k ? k + ': ' : ''}${I.action ? I.rule.expr.f : I.attr}`)},class="${I.action ? 'action' : ''}"];`;
    };
    const clusterDot = (n) => {
      const mine = [...res.inst.values()].filter((I) => I.node === n);
      let body;
      if (mine.length) {
        body = mine.map(instDot).join('');
        anchor.set(n.id, 'a' + mine[0].key.replace('.', '_'));
      } else {
        body = `p${n.id}[label="",shape=point,width=0.04,style=invis];`;
        anchor.set(n.id, `p${n.id}`);
      }
      return `subgraph cluster_${n.id}{label=${dq(nodeName(n))};fontname="JetBrains Mono";fontsize=12;style="rounded,dashed";class="ptnode";${body}}`;
    };
    dot += all.map(clusterDot).join('');
    for (const n of all) for (const c of n.kids || []) dot += `${anchor.get(n.id)}->${anchor.get(c.id)}[ltail=cluster_${n.id},lhead=cluster_${c.id},class="treeedge",arrowhead=none,weight=4];`;
    for (const [k, I] of res.inst) for (const d of I.deps) { dot += `a${d.replace('.', '_')}->a${k.replace('.', '_')}[class="dep",constraint=false];`; plain.edges.push({ from: d, to: k, label: '' }); }
    return { dot: dot + '}', ...plain };
  }
  function syntaxTreeGraph(res) {
    return {
      nodes: res.tree.map((n) => ({ id: n.sn, label: n.leaf ? [n.label, ...n.extra].join(' ') : n.label, shape: 'box', xlabel: `p${n.sn + 1}` })),
      edges: res.tree.flatMap((n) => n.kids.map((k) => ({ from: n.sn, to: k.sn, label: '' }))),
      rankdir: 'TB', ordering: true
    };
  }
  const checkChip = (r) => {
    if (!r.check) return '';
    const what = r.check.kind === 'post' ? 'one bottom-up (postorder) pass' : 'one depth-first, left-to-right pass';
    if (r.check.ok) return App.okChip(`${what} gives the same values`);
    if (r.check.stuck) return `<span class="chip">${esc(what)} is not enough: ${esc(r.check.stuck)}</span>`;
    return App.badChip(`${what} gives ${r.check.what} = ${r.check.b}, not ${r.check.a}`);
  };

  function sdTree(r) {
    const roots = r.res.error ? [] : attrsAt(r.res, r.root);
    return stage('sd-tree', '', 'Annotated parse tree', (r.yieldOk ? App.okChip(`the tree yields “${r.toks.map((t) => t.text).join(' ')}”`) : App.badChip('the tree does not yield the input')) + checkChip(r),
      `${r.res.error ? `<p><b>${esc(r.res.error)}</b></p>` : `<p>Each node shows the values of its attributes. ${roots.length ? `At the root: <b class="mono">${esc(roots.map((x) => `${r.root.sym}.${x}`).join(', '))}</b>.` : ''}</p>`}
       ${r.res.actions && r.res.actions.length ? `<div class="sub">Actions, in evaluation order</div><div class="prods">${r.res.actions.map(esc).join('\n')}</div>` : ''}
       ${ui.slot(annotatedGraph(r))}
       <details><summary>The SDD</summary>${sddTable(r.sdd)}</details>`);
  }
  function sdDep(r) {
    const res = r.res;
    if (res.error) return stage('sd-dep', '', 'Dependency graph', App.badChip('cycle'), `<p><b>${esc(res.error)}</b></p>`);
    const rows = res.order.map((k, i) => {
      const I = res.inst.get(k);
      const from = I.token ? `from the token “${I.node.tok.text}”` : esc(I.rule.text);
      return [String(i + 1), esc(`${I.action ? 'action' : `${I.node.sym}.${I.attr}`}`), `<span class="muted">node ${I.node.id}</span>`, from, esc(res.show(I.value))];
    });
    return stage('sd-dep', '', 'Dependency graph and evaluation order', chip('attribute instances', res.order.length) + (r.respects ? App.okChip('every edge goes from an earlier to a later step') : App.badChip('order breaks an edge')) + checkChip(r),
      `<div class="formula" style="white-space:normal">One graph node per attribute of each parse-tree node. An edge X.a → Y.b means the rule for Y.b reads X.a. Any topological order of the graph is a valid evaluation order; the numbers show one.</div>
       <p class="small muted">Dashed boxes are parse-tree nodes, dotted lines the parse tree, arrows the dependencies. Actions such as addType get a dummy attribute so they are ordered too.</p>
       ${ui.slot(dependencyGraph(r))}
       <div class="sub">Topological order</div>
       ${App.grid(['#', 'Attribute', 'Where', 'Rule', 'Value'], rows.map((x) => x.map((v, j) => (j === 3 ? { v, cls: 'l' } : v))))}`);
  }
  function sdCls(r) {
    const c = r.cls;
    const symRows = [...new Set([...c.syn.keys(), ...c.inh.keys()])].map((s) => [esc(s), esc([...(c.syn.get(s) || [])].join(', ')) || '—', esc([...(c.inh.get(s) || [])].join(', ')) || '—']);
    const lCell = (x) => {
      if (x.kind !== 'inherited') return '<span class="muted">always fine</span>';
      return x.ok ? '<span class="chip ok">✓ allowed</span>' : `<span class="chip bad">✗ ${esc(x.why)}</span>`;
    };
    const rows = c.rows.map((x) => [esc(SD.prodStr(x.p)), { v: esc(x.r.text), cls: 'l' }, x.kind, lCell(x)]);
    let verdict = `It is <b>neither S- nor L-attributed</b>: ${esc(c.lFails.length ? c.lFails[0].why : '')} in ${esc(c.lFails.length ? SD.prodStr(c.lFails[0].p) : '')}. A single left-to-right pass cannot evaluate it; it needs the full dependency graph.`;
    if (c.S) verdict = 'Every attribute is synthesized, so the SDD is <b>S-attributed</b>, and therefore also L-attributed. It can be evaluated bottom-up, for example during LR parsing.';
    else if (c.L) verdict = 'It has inherited attributes, so it is not S-attributed, but every inherited attribute uses only the head’s inherited attributes and symbols to its left: it is <b>L-attributed</b>. One depth-first, left-to-right pass evaluates it, as in a recursive-descent parser.';
    return stage('sd-cls', '', 'S-attributed and L-attributed', (c.S ? App.okChip('S-attributed') : App.badChip('not S-attributed')) + (c.L ? App.okChip('L-attributed') : App.badChip('not L-attributed')) + checkChip(r),
      `<div class="formula" style="white-space:normal">Synthesized: the rule defines an attribute of the head A. Inherited: it defines an attribute of a body symbol Xᵢ. S-attributed: synthesized only. L-attributed: an inherited Xᵢ.b may use only inherited attributes of A and attributes of X₁ … Xᵢ₋₁.</div>
       <p>${verdict}</p>
       ${App.grid(['Production', 'Rule', 'Kind', 'L-attributed?'], rows)}
       <div class="sub">Attributes by symbol</div>
       ${App.grid(['Symbol', 'Synthesized', 'Inherited'], symRows)}`);
  }
  function sdSyntax(r) {
    const res = r.res;
    if (res.error) return stage('sd-st', '', 'Syntax tree', '', `<p><b>${esc(res.error)}</b></p>`);
    if (!res.tree.length) return stage('sd-st', '', 'Syntax tree', '', '<p>These rules do not build a syntax tree. Use <b class="mono">new Node(op, left, right)</b> for an operator and <b class="mono">new Leaf(id, id.entry)</b> or <b class="mono">new Leaf(num, num.val)</b> for a leaf; try the “syntax tree” example.</p>');
    const steps = res.tree.map((n) => `<span class="v">p${n.sn + 1}</span> = ${esc(n.call.replace(/^(\w+)/, 'new $1'))}`).join('\n');
    return stage('sd-st', '', 'Syntax tree built by the semantic rules', chip('nodes', res.tree.length) + checkChip(r),
      `<p>Each call to Node or Leaf runs once, in the evaluation order of its rule, and returns a pointer to the new node. Unlike the parse tree, the syntax tree keeps only operators and operands.</p>
       <div class="cols"><div><div class="sub">Steps</div><div class="prods">${steps}</div></div><div>${ui.slot(syntaxTreeGraph(res))}</div></div>`);
  }
  function runSD(op) {
    lastSdOp = op || lastSdOp;
    $$('[data-sd]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sd === lastSdOp)));
    showErr($('#sdErr'), '');
    if (blank('#sdIn')) { store.set('sd', ''); emptyState($('#sdOut'), 'Type a grammar with semantic rules', 'Rules go in braces after each production, such as E -> E1 + T { E.val = E1.val + T.val }. Then give an input string.', 'sdt'); return; }
    let r;
    try { r = SD.run($('#sdIn').value, $('#sdW').value); } catch (e) {
      showErr($('#sdErr'), e.message);
      try { const sdd = SD.parseSDD($('#sdIn').value); if (lastSdOp === 'cls') ui.put($('#sdOut'), sdCls({ cls: SD.classify(sdd), sdd })); } catch { /* the SDD itself has an error: keep the message shown above */ }
      return;
    }
    store.set('sd', $('#sdIn').value); store.set('sdw', $('#sdW').value);
    let clsChip = '<span class="chip bad">not L-attributed</span>';
    if (r.cls.S) clsChip = '<span class="chip ok">S-attributed</span>';
    else if (r.cls.L) clsChip = '<span class="chip ok">L-attributed</span>';
    const views = { dep: sdDep, cls: sdCls, st: sdSyntax };
    const view = views[lastSdOp] || sdTree;
    const html = `<div class="summary">${chip('productions', r.sdd.prods.length)}${chip('tokens', r.toks.length)}${clsChip}</div>${view(r)}`;
    ui.put($('#sdOut'), html);
  }
  rerenders.sdt = () => runSD();
  $$('[data-sd]').forEach((b) => b.addEventListener('click', () => runSD(b.dataset.sd)));
  $('#sdW').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSD(); });

  App.export({ lastSdOp: () => lastSdOp, runSD: () => runSD });
})(window.DT);
