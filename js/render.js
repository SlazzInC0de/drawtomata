/* Rendering helpers: Graphviz (viz.js) diagrams with an SVG fallback, tables, small DOM utilities */
(function (DT) {
  'use strict';
  const EPS = DT.EPS;
  const ui = (DT.ui = DT.ui || {});
  ui.eps = 'λ';
  try { const s = localStorage.getItem('dt-eps'); if (s === 'ε' || s === 'λ') ui.eps = s; } catch (e) { /* storage unavailable */ }

  const D = (s) => String(s).replaceAll(EPS, ui.eps);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  ui.D = D; ui.esc = esc; ui.$ = $; ui.$$ = $$;

  const vizReady = (typeof window !== 'undefined' && window.Viz && window.Viz.instance)
    ? window.Viz.instance().catch(() => null)
    : Promise.resolve(null);

  // graph models
  function mergeEdges(trans, hide) {
    const m = new Map();
    for (const t of trans) {
      if (hide && (hide.has(t.from) || hide.has(t.to))) continue;
      const k = t.from + '>' + t.to;
      if (!m.has(k)) m.set(k, { from: t.from, to: t.to, syms: [] });
      if (!m.get(k).syms.includes(t.sym)) m.get(k).syms.push(t.sym);
    }
    return [...m.values()].map((e) => ({ from: e.from, to: e.to, label: e.syms.sort((a, b) => (a === EPS) - (b === EPS) || (a < b ? -1 : 1)).join(',') }));
  }
  function faGraph(fa, opts = {}) {
    const hide = opts.hide || new Set();
    const nodes = [];
    for (let i = 0; i < fa.n; i++) {
      if (hide.has(i)) continue;
      nodes.push({ id: i, label: fa.labels[i], start: i === fa.start, final: fa.finals.has(i), cls: opts.dead && opts.dead.has(i) ? 'dead' : '' });
    }
    return { nodes, edges: mergeEdges(fa.trans, hide) };
  }
  ui.faGraph = faGraph;

  // Graphviz
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  function toDot(g) {
    let s = 'digraph G{rankdir=LR;bgcolor="transparent";pad=0.15;nodesep=0.3;ranksep=0.45;';
    s += 'node[shape=circle,fontname="JetBrains Mono",fontsize=12,width=0.5,height=0.5,margin=0.02];';
    s += 'edge[fontname="JetBrains Mono",fontsize=11,arrowsize=0.7];';
    const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
    for (const n of g.nodes) if (n.start) { s += `s${idx.get(n.id)}[shape=point,style=invis,width=0.01,height=0.01];s${idx.get(n.id)}->n${idx.get(n.id)}[class="startarrow"];`; }
    for (const n of g.nodes) s += `n${idx.get(n.id)}[label=${q(D(n.label))},shape=${n.final ? 'doublecircle' : 'circle'},class=${q((n.cls || '') + (n.final ? ' final' : '') + (n.start ? ' start' : ''))}];`;
    for (const e of g.edges) if (idx.has(e.from) && idx.has(e.to)) s += `n${idx.get(e.from)}->n${idx.get(e.to)}[label=${q(' ' + D(e.label) + ' ')}];`;
    return s + '}';
  }
  function treeDot(root) {
    let s = 'digraph T{bgcolor="transparent";ordering=out;nodesep=0.25;ranksep=0.35;node[shape=plaintext,fontname="JetBrains Mono",fontsize=13,width=0.3,height=0.3,margin=0.04];edge[arrowhead=none];';
    const walk = (n) => {
      const v = DT.grammar.isVar(n.sym);
      s += `t${n.id}[label=${q(D(n.sym))},class=${q(v ? 'tvar' : 'tleaf')}];`;
      if (n.kids) for (const k of n.kids) { walk(k); s += `t${n.id}->t${k.id};`; }
    };
    walk(root);
    return s + '}';
  }

  let tokens = 0;
  async function renderDot(el, dot, fallback) {
    const tok = (el._tok = ++tokens);
    const viz = await vizReady;
    if (el._tok !== tok) return;
    if (viz) {
      try {
        const svg = viz.renderSVGElement(dot);
        svg.removeAttribute('width'); svg.removeAttribute('height');
        const vb = svg.viewBox.baseVal;
        if (vb && vb.width) { svg.style.width = Math.round(vb.width * 1.1) + 'px'; svg.style.maxWidth = 'none'; }
        el.replaceChildren(svg);
        return;
      } catch (e) { /* fall through */ }
    }
    el.replaceChildren(fallback());
  }
  function renderGraph(el, g) { return renderDot(el, toDot(g), () => fallbackSVG(g)); }
  function renderTree(el, root) {
    return renderDot(el, treeDot(root), () => {
      const pre = document.createElement('pre');
      pre.className = 'treeText';
      const lines = [];
      const walk = (n, pre2) => { lines.push(pre2 + D(n.sym)); if (n.kids) n.kids.forEach((k) => walk(k, pre2 + '  ')); };
      walk(root, '');
      pre.textContent = lines.join('\n');
      return pre;
    });
  }
  ui.renderGraph = renderGraph; ui.renderTree = renderTree;

  // plain SVG drawing (fallback and the editor canvas)
  let uid = 0;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function layered(g) {
    const ids = g.nodes.map((n) => n.id), adj = new Map(ids.map((i) => [i, []]));
    g.edges.forEach((e) => adj.has(e.from) && adj.get(e.from).push(e.to));
    const dist = new Map(), start = (g.nodes.find((n) => n.start) || g.nodes[0] || {}).id;
    if (start !== undefined) { dist.set(start, 0); const qq = [start]; while (qq.length) { const u = qq.shift(); for (const v of adj.get(u) || []) if (!dist.has(v)) { dist.set(v, dist.get(u) + 1); qq.push(v); } } }
    let mx = Math.max(0, ...dist.values());
    ids.forEach((i) => { if (!dist.has(i)) dist.set(i, ++mx); });
    const layers = new Map();
    ids.forEach((i) => { const L = dist.get(i); if (!layers.has(L)) layers.set(L, []); layers.get(L).push(i); });
    const pos = new Map();
    for (const [L, arr] of layers) arr.forEach((id, k) => pos.set(id, { x: 70 + L * 130, y: 90 + (k - (arr.length - 1) / 2) * 95 }));
    return pos;
  }
  ui.layered = layered;
  function fallbackSVG(g) {
    const pos = layered(g);
    const xs = [...pos.values()].map((p) => p.x), ys = [...pos.values()].map((p) => p.y);
    const minX = Math.min(...xs) - 70, maxX = Math.max(...xs) + 50, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 50;
    const svg = mk('svg', { viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, class: 'fallback' });
    svg.style.width = Math.max(260, maxX - minX) + 'px';
    drawGraph(svg, { nodes: g.nodes.map((n) => ({ ...n, ...pos.get(n.id) })), edges: g.edges });
    return svg;
  }
  function drawGraph(svg, g, opts = {}) {
    const r = opts.r || 22;
    svg.replaceChildren();
    const mid = 'ah' + ++uid;
    const defs = mk('defs', {});
    const marker = mk('marker', { id: mid, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.appendChild(mk('path', { d: 'M0,0 L10,5 L0,10 z', class: 'ahead' }));
    const smarker = mk('marker', { id: mid + 's', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    smarker.appendChild(mk('path', { d: 'M0,0 L10,5 L0,10 z', class: 'ahead start' }));
    defs.appendChild(marker); defs.appendChild(smarker); svg.appendChild(defs);
    if (opts.grid) {
      const pat = mk('pattern', { id: mid + 'g', width: 24, height: 24, patternUnits: 'userSpaceOnUse' });
      pat.appendChild(mk('circle', { cx: 12, cy: 12, r: 1.1, class: 'gridDot' }));
      defs.appendChild(pat);
      const G = opts.grid;
      svg.appendChild(mk('rect', { x: G.x, y: G.y, width: G.w, height: G.h, fill: `url(#${mid}g)`, class: 'gridRect' }));
    }
    const pos = new Map(g.nodes.map((n) => [n.id, n]));
    const pairs = new Set(g.edges.map((e) => e.from + '>' + e.to));
    const loopAngle = (a, id) => {
      const dirs = [];
      for (const e of g.edges) {
        if (e.from === e.to) continue;
        const o = e.from === id ? pos.get(e.to) : e.to === id ? pos.get(e.from) : null;
        if (o) dirs.push(Math.atan2(o.y - a.y, o.x - a.x));
      }
      if (a.start) dirs.push(Math.PI);
      const cands = [-Math.PI / 2, Math.PI / 2, 0, Math.PI, -Math.PI / 4, (-3 * Math.PI) / 4, Math.PI / 4, (3 * Math.PI) / 4];
      let best = cands[0], bestGap = -1;
      for (const c of cands) {
        let gap = Math.PI;
        for (const d of dirs) { let x = Math.abs(c - d) % (2 * Math.PI); if (x > Math.PI) x = 2 * Math.PI - x; gap = Math.min(gap, x); }
        if (gap > bestGap + 0.2) { bestGap = gap; best = c; }
      }
      return best;
    };
    const eg = mk('g', {}), ng = mk('g', {});
    svg.appendChild(eg); svg.appendChild(ng);
    for (const e of g.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) continue;
      let d, lx, ly;
      if (e.from === e.to) {
        // put the loop on the side of the state with the most free space
        const th = loopAngle(a, e.from);
        const ux = Math.cos(th), uy = Math.sin(th), px = -uy, py = ux;
        const sx = a.x + r * Math.cos(th - 0.44), sy = a.y + r * Math.sin(th - 0.44);
        const ex = a.x + r * Math.cos(th + 0.44), ey = a.y + r * Math.sin(th + 0.44);
        d = `M${sx},${sy} C${sx + 52 * ux - 22 * px},${sy + 52 * uy - 22 * py} ${ex + 52 * ux + 22 * px},${ey + 52 * uy + 22 * py} ${ex},${ey}`;
        lx = a.x + (r + 46) * ux; ly = a.y + (r + 46) * uy + 4;
      } else {
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const off = pairs.has(e.to + '>' + e.from) ? 26 : 0;
        const cx = (a.x + b.x) / 2 + nx * off * 2, cy = (a.y + b.y) / 2 + ny * off * 2;
        const u1 = Math.hypot(cx - a.x, cy - a.y) || 1, u2 = Math.hypot(b.x - cx, b.y - cy) || 1;
        const sx = a.x + (r * (cx - a.x)) / u1, sy = a.y + (r * (cy - a.y)) / u1;
        const ex = b.x - (r * (b.x - cx)) / u2, ey = b.y - (r * (b.y - cy)) / u2;
        d = `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
        const side = off ? 1 : ny > 0 ? -1 : 1;
        lx = 0.25 * sx + 0.5 * cx + 0.25 * ex + nx * 11 * side; ly = 0.25 * sy + 0.5 * cy + 0.25 * ey + ny * 11 * side + 4;
      }
      const grp = mk('g', { class: 'fedge ' + (e.cls || ''), 'data-edge': e.from + '>' + e.to });
      grp.appendChild(mk('path', { d, class: 'hit' }));
      grp.appendChild(mk('path', { d, class: 'eline', 'marker-end': `url(#${mid})` }));
      const tx = mk('text', { x: lx, y: ly, class: 'elabel', 'text-anchor': 'middle' });
      tx.textContent = D(e.label);
      grp.appendChild(tx);
      eg.appendChild(grp);
    }
    for (const n of g.nodes) {
      const grp = mk('g', { class: 'fnode ' + (n.cls || '') + (n.final ? ' final' : '') + (n.start ? ' start' : ''), 'data-id': n.id });
      if (n.start) grp.appendChild(mk('path', { d: `M${n.x - r - 34},${n.y} L${n.x - r - 2},${n.y}`, class: 'eline start', 'marker-end': `url(#${mid}s)` }));
      grp.appendChild(mk('circle', { cx: n.x, cy: n.y, r, class: 'ncircle' }));
      if (n.final) grp.appendChild(mk('circle', { cx: n.x, cy: n.y, r: r - 4.5, class: 'ninner' }));
      const tx = mk('text', { x: n.x, y: n.y + 4.5, class: 'nlabel', 'text-anchor': 'middle' });
      tx.textContent = D(n.label);
      grp.appendChild(tx);
      ng.appendChild(grp);
    }
    if (opts.preview) eg.appendChild(mk('path', { d: opts.preview, class: 'eline preview' }));
  }
  ui.drawGraph = drawGraph;

  // deferred diagram slots inside HTML strings
  const queue = [];
  let gid = 0;
  ui.slot = (g, cls = '') => { const id = 'gv' + ++gid; queue.push([id, 'g', g]); return `<div class="gv ${cls}" id="${id}"><div class="gv-wait">drawing…</div></div>`; };
  ui.treeSlot = (root) => { const id = 'gv' + ++gid; queue.push([id, 't', root]); return `<div class="gv tree" id="${id}"><div class="gv-wait">drawing…</div></div>`; };
  ui.flush = () => {
    for (const [id, kind, g] of queue.splice(0)) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (kind === 'g') renderGraph(el, g); else renderTree(el, g);
    }
  };
  ui.put = (el, html) => { el.innerHTML = D(html); ui.flush(); };

  // tables
  ui.table = (head, rows, cls = '') =>
    `<div class="tbl"><table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ''}>${(r.cells || r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  ui.stateCell = (fa, i) => `${i === fa.start ? '<span class="mk-start" title="start">→</span>' : ''}${fa.finals.has(i) ? '<span class="mk-final" title="final">*</span>' : ''}${esc(fa.labels[i])}`;
  ui.faTable = (fa, opts = {}) => {
    const A = DT.fa.alphabetOf(fa);
    const cols = opts.eps || DT.fa.hasEps(fa) ? [...A, EPS] : A;
    const d = DT.fa.delta(fa);
    const hide = opts.hide || new Set();
    const rows = [];
    for (let i = 0; i < fa.n; i++) {
      if (hide.has(i)) continue;
      rows.push([ui.stateCell(fa, i), ...cols.map((a) => {
        const s = d[i].get(a);
        if (!s || !s.size) return '<span class="none">∅</span>';
        const arr = DT.fa.sortNum(s).map((x) => esc(fa.labels[x]));
        return DT.fa.isDFA(fa) ? arr[0] : '{' + arr.join(',') + '}';
      })]);
    }
    return ui.table(['δ', ...cols.map(esc)], rows, 'mono');
  };
  ui.legend = '<p class="legend"><span class="mk-start">→</span> start state &nbsp; <span class="mk-final">*</span> final state</p>';
})(window.DT);
