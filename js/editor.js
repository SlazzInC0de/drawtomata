/* FA canvas: infinite pan/zoom, states and transitions, undo/redo, autosave, export. */
(function (DT) {
  'use strict';
  const ui = DT.ui, EPS = DT.EPS;
  const R = 24;
  const MIN_K = 0.25, MAX_K = 3;

  function Editor(root, opts = {}) {
    const svg = root.querySelector('svg.canvas');
    const ctx = root.querySelector('#ctx');
    const st = {
      states: [], trans: [], tool: 'move',
      sel: null,            // {kind:'node', id} | {kind:'edge', from, to}
      pending: null,        // node id while picking a transition target
      draft: null,          // {from, to} transition waiting for symbols
      nextId: 0, view: { x: -80, y: -60, k: 1 }
    };
    let drag = null, hover = null;
    const listeners = [];

    // model helpers
    const byId = (id) => st.states.find((s) => s.id === id);
    const nameUsed = (nm, except) => st.states.some((s) => s.name === nm && s.id !== except);
    const nextName = () => { let k = 0; while (nameUsed('q' + k)) k++; return 'q' + k; };
    const symsOf = (from, to) => st.trans.filter((t) => t.from === from && t.to === to).map((t) => t.sym);
    const serialize = () => JSON.stringify({ v: 1, states: st.states.map(({ id, name, x, y, start, final }) => ({ id, name, x: Math.round(x), y: Math.round(y), start, final })), trans: st.trans });
    // Imported files are untrusted: strict mode rejects anything the editor itself could not have made.
    // Autosaves use lenient mode so an upgrade never throws away a user's canvas.
    const MAX_JSON = 1_000_000, MAX_STATES = 5000, MAX_TRANS = 50000, MAX_NAME = 200, MAX_ID = 1e9;
    const BAD_NAME = /[\s,{}()]/;
    function apply(json, strict = true) {
      const fail = (msg) => { throw new Error(msg); };
      if (typeof json !== 'string') fail('Not a Drawtomata file.');
      if (strict && json.length > MAX_JSON) fail('File is too large (max 1 MB).');
      const o = JSON.parse(json);
      if (!o || typeof o !== 'object') fail('Not a Drawtomata file.');
      const states = o.states || o.s, trans = o.trans || o.t;
      if (!Array.isArray(states) || !Array.isArray(trans)) fail('Not a Drawtomata file.');
      if (strict && states.length > MAX_STATES) fail(`Too many states (max ${MAX_STATES}).`);
      if (strict && trans.length > MAX_TRANS) fail(`Too many transitions (max ${MAX_TRANS}).`);
      const coord = (v) => {
        if (v === undefined) return 0;
        if (typeof v === 'number' && Number.isFinite(v)) return Math.max(-1e6, Math.min(1e6, v));
        return strict ? fail('State coordinates must be numbers.') : 0;
      };
      const flag = (v) => {
        if (v === undefined || typeof v === 'boolean') return v === true;
        return strict ? fail('start and final must be true or false.') : v === true;
      };
      const ids = new Set(), names = new Set();
      let starts = 0, maxId = -1;
      const clean = states.map((s) => {
        if (!s || typeof s !== 'object' || !Number.isSafeInteger(s.id) || s.id < 0 || s.id > MAX_ID || ids.has(s.id)) fail('Invalid or duplicate state id.');
        if (typeof s.name !== 'string' || !s.name.trim()) fail('Every state needs a name.');
        if (strict && (s.name.length > MAX_NAME || BAD_NAME.test(s.name))) fail(`State "${s.name.slice(0, 20)}" has an invalid name (no spaces, commas or brackets, max ${MAX_NAME} characters).`);
        if (names.has(s.name)) fail(`Duplicate state name "${s.name.slice(0, 20)}".`);
        ids.add(s.id); names.add(s.name); maxId = Math.max(maxId, s.id);
        let start = flag(s.start);
        if (start && ++starts > 1) { if (strict) fail('Only one state can be the start state.'); start = false; }
        return { id: s.id, name: s.name, x: coord(s.x), y: coord(s.y), start, final: flag(s.final) };
      });
      const seen = new Set(), cleanT = [];
      for (const t of trans) {
        if (!t || typeof t !== 'object' || !ids.has(t.from) || !ids.has(t.to)) fail('A transition points to a state that does not exist.');
        if (typeof t.sym !== 'string') fail('Transition symbols must be text.');
        const sym = DT.isEps(t.sym) ? EPS : t.sym;
        if (strict && sym !== EPS && !/^[a-zA-Z0-9]$/.test(sym)) fail(`"${sym.slice(0, 10)}" is not one symbol. Use single letters, digits or λ.`);
        const k = t.from + '|' + t.to + '|' + sym;
        if (!seen.has(k)) { seen.add(k); cleanT.push({ from: t.from, to: t.to, sym }); }
      }
      st.states = clean;
      st.trans = cleanT;
      st.nextId = maxId + 1;
      st.sel = null; st.pending = null; st.draft = null;
    }

    // history + autosave
    let hist = [], hi = -1, saveTimer = null;
    function commit() {
      const s = serialize();
      if (hist[hi] === s) { draw(); return; }
      hist = hist.slice(0, hi + 1);
      hist.push(s);
      if (hist.length > 200) hist.shift();
      hi = hist.length - 1;
      draw();
      scheduleSave(s);
      listeners.forEach((f) => f());
    }
    function scheduleSave(s) {
      setStatus('Saving…');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem('dt-editor', s); setStatus('Saved'); }
        catch (e) { setStatus('Not saved: browser storage is blocked', true); }
      }, 250);
    }
    function setStatus(text, bad) {
      const el = root.querySelector('#saveState');
      el.textContent = text; el.classList.toggle('bad', !!bad);
    }
    function undo() { if (hi > 0) { hi--; apply(hist[hi]); draw(); scheduleSave(hist[hi]); listeners.forEach((f) => f()); } }
    function redo() { if (hi < hist.length - 1) { hi++; apply(hist[hi]); draw(); scheduleSave(hist[hi]); listeners.forEach((f) => f()); } }

    // view
    const size = () => ({ w: svg.clientWidth || 800, h: svg.clientHeight || 500 });
    function applyView() {
      const { w, h } = size(), v = st.view;
      svg.setAttribute('viewBox', `${v.x} ${v.y} ${w / v.k} ${h / v.k}`);
      root.querySelector('#zoomPct').textContent = Math.round(v.k * 100) + '%';
    }
    function zoomAt(k, sx, sy) {
      const { w, h } = size(), v = st.view;
      k = Math.min(MAX_K, Math.max(MIN_K, k));
      if (sx === undefined) { sx = w / 2; sy = h / 2; }
      const wx = v.x + sx / v.k, wy = v.y + sy / v.k;
      v.k = k; v.x = wx - sx / k; v.y = wy - sy / k;
      draw();
    }
    function bounds() {
      if (!st.states.length) return null;
      const xs = st.states.map((s) => s.x), ys = st.states.map((s) => s.y);
      return { x0: Math.min(...xs) - R - 50, y0: Math.min(...ys) - R - 60, x1: Math.max(...xs) + R + 30, y1: Math.max(...ys) + R + 30 };
    }
    function fit() {
      const b = bounds(), { w, h } = size();
      if (!b) { st.view = { x: -w / 2, y: -h / 2, k: 1 }; draw(); return; }
      const padL = w > 700 ? 80 : 20, padT = 70, padR = 30, padB = 60;
      const k = Math.min(1.6, Math.max(MIN_K, Math.min((w - padL - padR) / (b.x1 - b.x0), (h - padT - padB) / (b.y1 - b.y0))));
      st.view = { k, x: b.x0 - (padL + (w - padL - padR - (b.x1 - b.x0) * k) / 2) / k, y: b.y0 - (padT + (h - padT - padB - (b.y1 - b.y0) * k) / 2) / k };
      draw();
    }
    function toWorld(e) {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }
    function toLocal(wx, wy) {
      const v = st.view;
      return { x: (wx - v.x) * v.k, y: (wy - v.y) * v.k };
    }

    // drawing
    function draw() {
      applyView();
      const v = st.view, { w, h } = size();
      const merged = new Map();
      for (const t of st.trans) {
        const k = t.from + '>' + t.to;
        if (!merged.has(k)) merged.set(k, { from: t.from, to: t.to, syms: [] });
        merged.get(k).syms.push(t.sym);
      }
      if (st.draft && !merged.has(st.draft.from + '>' + st.draft.to)) merged.set(st.draft.from + '>' + st.draft.to, { from: st.draft.from, to: st.draft.to, syms: ['?'], draft: true });
      const selEdge = st.sel && st.sel.kind === 'edge' ? st.sel.from + '>' + st.sel.to : null;
      const nodes = st.states.map((s) => ({ id: s.id, label: s.name, x: s.x, y: s.y, start: s.start, final: s.final, cls: (st.sel && st.sel.kind === 'node' && st.sel.id === s.id ? 'sel ' : '') + (st.pending === s.id ? 'pending' : '') }));
      const edges = [...merged.values()].map((e) => ({ from: e.from, to: e.to, label: e.syms.join(','), cls: (e.draft ? 'draft ' : '') + (selEdge === e.from + '>' + e.to ? 'sel' : '') }));
      let preview = null;
      if (st.pending !== null && hover) { const a = byId(st.pending); if (a) preview = `M${a.x},${a.y} L${hover.x},${hover.y}`; }
      ui.drawGraph(svg, { nodes, edges }, { preview, r: R, grid: { x: v.x - 24, y: v.y - 24, w: w / v.k + 48, h: h / v.k + 48 } });
      root.querySelector('.emptyHint').hidden = st.states.length > 0;
      root.querySelector('#objCount').textContent = `${st.states.length} state${st.states.length === 1 ? '' : 's'} · ${st.trans.length} transition${st.trans.length === 1 ? '' : 's'}`;
      root.querySelector('#undoBtn').disabled = hi <= 0;
      root.querySelector('#redoBtn').disabled = hi >= hist.length - 1;
      placeCtx();
    }

    // contextual toolbar
    const ctxNode = ctx.querySelector('.ctxNode'), ctxEdge = ctx.querySelector('.ctxEdge');
    let ctxKey = null;
    function placeCtx() {
      let anchor = null, mode = null, key = null;
      if (st.draft) { mode = 'edge'; key = 'd' + st.draft.from + '>' + st.draft.to; anchor = mid(st.draft.from, st.draft.to); }
      else if (st.sel && st.sel.kind === 'edge') { mode = 'edge'; key = 'e' + st.sel.from + '>' + st.sel.to; anchor = mid(st.sel.from, st.sel.to); }
      else if (st.sel && st.sel.kind === 'node' && !drag) { const s = byId(st.sel.id); if (s) { mode = 'node'; key = 'n' + s.id; anchor = { x: s.x, y: s.y - R }; } }
      if (!mode || !anchor) { ctx.hidden = true; ctxKey = null; return; }
      ctx.hidden = false;
      ctxNode.hidden = mode !== 'node'; ctxEdge.hidden = mode !== 'edge';
      if (key !== ctxKey) {
        ctxKey = key;
        root.querySelector('#ctxErr').textContent = '';
        if (mode === 'node') {
          const s = byId(st.sel.id);
          root.querySelector('#selName').value = s.name;
        } else {
          const e = st.draft || st.sel;
          ctx.querySelector('.edgeWhat').textContent = `${byId(e.from).name} → ${byId(e.to).name}`;
          const inp = root.querySelector('#edgeSyms');
          inp.value = st.draft ? '' : ui.D(symsOf(e.from, e.to).join(', '));
          setTimeout(() => { inp.focus(); inp.select(); }, 0);
        }
      }
      if (mode === 'node') {
        const s = byId(st.sel.id);
        root.querySelector('#selStart').setAttribute('aria-pressed', String(s.start));
        root.querySelector('#selFinal').setAttribute('aria-pressed', String(s.final));
      }
      const p = toLocal(anchor.x, anchor.y);
      const W = root.clientWidth, cw = ctx.offsetWidth, ch = ctx.offsetHeight;
      let left = p.x - cw / 2, top = p.y - ch - 14;
      if (top < 60) top = p.y + (mode === 'node' ? 2 * R * st.view.k : 0) + 24;
      left = Math.max(8, Math.min(W - cw - 8, left));
      ctx.style.left = left + 'px'; ctx.style.top = top + 'px';
    }
    function mid(a, b) {
      const A = byId(a), B = byId(b);
      if (!A || !B) return null;
      if (a === b) return { x: A.x, y: A.y - R - 44 };
      return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 10 };
    }

    // edits
    function addState(x, y) {
      const snap = (v) => Math.round(v / 12) * 12;
      const s = { id: st.nextId++, name: nextName(), x: snap(x), y: snap(y), start: !st.states.some((z) => z.start), final: false };
      st.states.push(s);
      st.sel = { kind: 'node', id: s.id };
      commit();
    }
    function removeState(id) {
      st.states = st.states.filter((s) => s.id !== id);
      st.trans = st.trans.filter((t) => t.from !== id && t.to !== id);
      st.sel = null; st.pending = null; st.draft = null;
      commit();
    }
    function removeEdge(from, to) {
      st.trans = st.trans.filter((t) => !(t.from === from && t.to === to));
      st.sel = null; st.draft = null;
      commit();
    }
    function parseSyms(text) {
      const parts = text.split(/[\s,]+/).filter(Boolean);
      if (!parts.length) throw new Error('Type at least one symbol: a, or a,b, or λ');
      return [...new Set(parts.map((p) => {
        if (DT.isEps(p)) return EPS;
        if (!/^[a-zA-Z0-9]$/.test(p)) throw new Error(`"${p}" is not one symbol. Use single letters or digits, separated by commas.`);
        return p;
      }))];
    }
    function saveEdge() {
      const e = st.draft || (st.sel && st.sel.kind === 'edge' ? st.sel : null);
      if (!e) return;
      try {
        const syms = parseSyms(root.querySelector('#edgeSyms').value);
        st.trans = st.trans.filter((t) => !(t.from === e.from && t.to === e.to));
        syms.forEach((sym) => st.trans.push({ from: e.from, to: e.to, sym }));
        st.draft = null; st.sel = null; ctxKey = null;
        commit();
      } catch (err) { root.querySelector('#ctxErr').textContent = ui.D(err.message); }
    }
    function startEdge(from, to) {
      if (st.trans.some((t) => t.from === from && t.to === to)) st.sel = { kind: 'edge', from, to };
      else { st.draft = { from, to }; st.sel = null; }
      ctxKey = null;
      draw();
    }
    function cancel() {
      st.draft = null; st.pending = null; hover = null;
      if (st.sel) st.sel = null;
      draw();
    }
    function setTool(t) {
      st.tool = t; st.pending = null; st.draft = null;
      root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      svg.dataset.tool = t;
      draw();
    }

    // pointer
    svg.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || (e.button === 0 && (st.tool === 'pan' || spaceDown))) { startPan(e); return; }
      if (e.button !== 0) return;
      const p = toWorld(e);
      const ng = e.target.closest('[data-id]'), eg = e.target.closest('[data-edge]');
      const id = ng ? +ng.dataset.id : null;
      const edge = eg ? eg.dataset.edge.split('>').map(Number) : null;
      if (st.draft && !ng) { st.draft = null; }

      if (st.tool === 'delete') {
        if (id !== null) removeState(id);
        else if (edge) removeEdge(edge[0], edge[1]);
        return;
      }
      if (st.tool === 'edge') {
        if (id === null) { st.pending = null; draw(); return; }
        if (st.pending === null) { st.pending = id; drag = { kind: 'link', moved: false, sx: e.clientX, sy: e.clientY }; svg.setPointerCapture(e.pointerId); draw(); }
        else { const from = st.pending; st.pending = null; startEdge(from, id); }
        return;
      }
      if (st.tool === 'state' && id === null && !edge) { addState(p.x, p.y); return; }
      if (id !== null) {
        const s = byId(id);
        st.sel = { kind: 'node', id };
        drag = { kind: 'node', id, dx: p.x - s.x, dy: p.y - s.y, moved: false, sx: e.clientX, sy: e.clientY };
        svg.setPointerCapture(e.pointerId);
        draw();
      } else if (edge) {
        st.sel = { kind: 'edge', from: edge[0], to: edge[1] };
        ctxKey = null; draw();
      } else {
        st.sel = null; draw();
        startPan(e);
      }
    });
    function startPan(e) {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: st.view.x, vy: st.view.y };
      svg.classList.add('panning');
      svg.setPointerCapture(e.pointerId);
    }
    svg.addEventListener('pointermove', (e) => {
      if (drag && drag.kind === 'pan') {
        st.view.x = drag.vx - (e.clientX - drag.sx) / st.view.k;
        st.view.y = drag.vy - (e.clientY - drag.sy) / st.view.k;
        draw(); return;
      }
      if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      const p = toWorld(e);
      if (drag && drag.kind === 'node' && drag.moved) { const s = byId(drag.id); s.x = p.x - drag.dx; s.y = p.y - drag.dy; ctx.hidden = true; draw(); }
      else if (st.pending !== null) { hover = p; draw(); }
    });
    function endDrag(e) {
      if (!drag) return;
      const d = drag; drag = null;
      svg.classList.remove('panning');
      if (d.kind === 'node') {
        if (d.moved) { const s = byId(d.id); s.x = Math.round(s.x / 12) * 12; s.y = Math.round(s.y / 12) * 12; ctxKey = null; commit(); }
        else draw();
      } else if (d.kind === 'link' && d.moved) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const ng = el && el.closest && el.closest('[data-id]');
        const from = st.pending;
        st.pending = null; hover = null;
        if (ng && from !== null) startEdge(from, +ng.dataset.id); else draw();
      }
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('dblclick', (e) => {
      const ng = e.target.closest('[data-id]');
      if (ng) { st.sel = { kind: 'node', id: +ng.dataset.id }; ctxKey = null; draw(); const n = root.querySelector('#selName'); n.focus(); n.select(); return; }
      if (!e.target.closest('[data-edge]') && st.tool === 'move') { const p = toWorld(e); addState(p.x, p.y); }
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(st.view.k * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else { st.view.x += e.deltaX / st.view.k; st.view.y += e.deltaY / st.view.k; draw(); }
    }, { passive: false });
    new ResizeObserver(() => draw()).observe(svg);

    // keyboard
    let spaceDown = false;
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
    document.addEventListener('keydown', (e) => {
      if (!opts.isActive()) return;
      if (e.key === 'Escape') { if (typing()) document.activeElement.blur(); cancel(); return; }
      if (typing()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.key === ' ') { spaceDown = true; svg.classList.add('panning'); e.preventDefault(); return; }
      const keyTool = { v: 'move', h: 'pan', s: 'state', a: 'edge', t: 'edge', e: 'delete' }[e.key.toLowerCase()];
      if (keyTool) { setTool(keyTool); return; }
      if (e.key === 'f' || e.key === 'F') { fit(); return; }
      if (e.key === '+' || e.key === '=') { zoomAt(st.view.k * 1.2); return; }
      if (e.key === '-' || e.key === '_') { zoomAt(st.view.k / 1.2); return; }
      if (e.key === '0') { zoomAt(1); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) {
        e.preventDefault();
        if (st.sel.kind === 'node') removeState(st.sel.id); else removeEdge(st.sel.from, st.sel.to);
      }
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; svg.classList.remove('panning'); } });

    // controls
    root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    root.querySelector('#zoomIn').addEventListener('click', () => zoomAt(st.view.k * 1.2));
    root.querySelector('#zoomOut').addEventListener('click', () => zoomAt(st.view.k / 1.2));
    root.querySelector('#zoomPct').addEventListener('click', () => zoomAt(1));
    root.querySelector('#zoomFit').addEventListener('click', fit);
    root.querySelector('#undoBtn').addEventListener('click', undo);
    root.querySelector('#redoBtn').addEventListener('click', redo);
    root.querySelector('#edgeForm').addEventListener('submit', (e) => { e.preventDefault(); saveEdge(); });
    root.querySelector('#edgeDelete').addEventListener('click', () => {
      if (st.draft) { st.draft = null; draw(); }
      else if (st.sel && st.sel.kind === 'edge') removeEdge(st.sel.from, st.sel.to);
    });
    const nameInput = root.querySelector('#selName');
    nameInput.addEventListener('change', () => {
      const s = st.sel && st.sel.kind === 'node' ? byId(st.sel.id) : null;
      if (!s) return;
      const v = nameInput.value.trim(), err = root.querySelector('#ctxErr');
      if (!v) { err.textContent = 'Name cannot be empty.'; return; }
      if (nameUsed(v, s.id)) { err.textContent = 'Another state already has this name.'; return; }
      if (/[\s,{}()]/.test(v)) { err.textContent = 'No spaces, commas or brackets in names.'; return; }
      if (v.length > MAX_NAME) { err.textContent = `Keep names under ${MAX_NAME} characters.`; return; }
      err.textContent = ''; s.name = v; commit();
    });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { nameInput.blur(); } });
    root.querySelector('#selStart').addEventListener('click', () => {
      const s = st.sel && byId(st.sel.id); if (!s) return;
      const on = !s.start; st.states.forEach((z) => (z.start = false)); s.start = on; commit();
    });
    root.querySelector('#selFinal').addEventListener('click', () => { const s = st.sel && byId(st.sel.id); if (s) { s.final = !s.final; commit(); } });
    root.querySelector('#selDelete').addEventListener('click', () => { if (st.sel && st.sel.kind === 'node') removeState(st.sel.id); });

    // import / export
    function exportSVGString() {
      const b = bounds();
      if (!b) throw new Error('Nothing to export yet.');
      const NS = 'http://www.w3.org/2000/svg';
      const out = document.createElementNS(NS, 'svg');
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      out.setAttribute('xmlns', NS);
      out.setAttribute('viewBox', `${b.x0} ${b.y0} ${w} ${h}`);
      out.setAttribute('width', w); out.setAttribute('height', h);
      out.style.position = 'absolute'; out.style.left = '-99999px';
      document.body.appendChild(out);
      const merged = new Map();
      for (const t of st.trans) { const k = t.from + '>' + t.to; if (!merged.has(k)) merged.set(k, { from: t.from, to: t.to, syms: [] }); merged.get(k).syms.push(t.sym); }
      ui.drawGraph(out, { nodes: st.states.map((s) => ({ id: s.id, label: s.name, x: s.x, y: s.y, start: s.start, final: s.final })), edges: [...merged.values()].map((e) => ({ from: e.from, to: e.to, label: e.syms.join(',') })) }, { r: R });
      const bg = getComputedStyle(svg.parentElement).backgroundColor;
      out.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'paint-order', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight'].forEach((p) => { const v = cs.getPropertyValue(p); if (v) el.setAttribute(p, v); });
        el.removeAttribute('class');
      });
      out.querySelectorAll('.hit, path[stroke="transparent"], path[stroke="rgba(0, 0, 0, 0)"]').forEach((el) => el.remove());
      const bgRect = document.createElementNS(NS, 'rect');
      bgRect.setAttribute('x', b.x0); bgRect.setAttribute('y', b.y0); bgRect.setAttribute('width', w); bgRect.setAttribute('height', h); bgRect.setAttribute('fill', bg);
      out.insertBefore(bgRect, out.firstChild);
      out.removeAttribute('style');
      const str = new XMLSerializer().serializeToString(out);
      out.remove();
      return { str, w, h };
    }
    function download(name, blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    function exportAs(kind) {
      if (kind === 'json') { download('automaton.json', new Blob([serialize()], { type: 'application/json' })); return; }
      const { str, w, h } = exportSVGString();
      if (kind === 'svg') { download('automaton.svg', new Blob([str], { type: 'image/svg+xml' })); return; }
      const img = new Image(), scale = 2;
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
        const g = c.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0, w, h);
        c.toBlob((blob) => blob && download('automaton.png', blob), 'image/png');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
    }
    function importJSON(text) { apply(text); commit(); fit(); }

    // public
    function toFA() {
      if (!st.states.length) throw new Error('Draw at least one state first.');
      const start = st.states.findIndex((s) => s.start);
      if (start < 0) throw new Error('No start state. Select a state and press Start.');
      const idx = new Map(st.states.map((s, i) => [s.id, i]));
      return { n: st.states.length, start, finals: new Set(st.states.map((s, i) => (s.final ? i : -1)).filter((i) => i >= 0)), trans: st.trans.map((t) => ({ from: idx.get(t.from), sym: t.sym, to: idx.get(t.to) })), labels: st.states.map((s) => s.name) };
    }
    function layoutFA(fa) {
      const pos = ui.layered(ui.faGraph(fa));
      return [...Array(fa.n).keys()].map((i) => ({ x: pos.get(i).x * 1.25, y: pos.get(i).y * 1.25 }));
    }
    function load(fa, o = {}) {
      const rename = o.rename !== false && fa.labels.some((l) => /[{}(),∅\s]/.test(l));
      const pos = layoutFA(fa);
      st.states = []; st.trans = []; st.sel = null; st.pending = null; st.draft = null; st.nextId = 0;
      const map = new Map();
      for (let i = 0; i < fa.n; i++) {
        const s = { id: st.nextId++, name: rename ? 'q' + i : fa.labels[i], x: pos[i].x, y: pos[i].y, start: i === fa.start, final: fa.finals.has(i) };
        map.set(i, s.id); st.states.push(s);
      }
      for (const t of fa.trans) if (!st.trans.some((x) => x.from === map.get(t.from) && x.to === map.get(t.to) && x.sym === t.sym)) st.trans.push({ from: map.get(t.from), to: map.get(t.to), sym: t.sym });
      commit(); fit();
      return rename;
    }
    function tidy() {
      if (!st.states.length) return;
      const fa = toFA(), pos = layoutFA(fa);
      st.states.forEach((s, i) => { s.x = pos[i].x; s.y = pos[i].y; });
      commit(); fit();
    }
    function clear() { st.states = []; st.trans = []; st.sel = null; st.pending = null; st.draft = null; commit(); fit(); }
    function restore(json) { apply(json, false); hist = [serialize()]; hi = 0; draw(); fit(); }

    setTool('move');
    return { toFA, load, clear, restore, tidy, fit, exportAs, importJSON, onChange: (f) => listeners.push(f), redraw: draw, cancel, count: () => st.states.length };
  }
  DT.Editor = Editor;
})(window.DT);
