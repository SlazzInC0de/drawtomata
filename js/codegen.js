/* Code generation (Aho ch. 6 and 8): three-address code, DAGs by value numbers,
   SSA, basic blocks, liveness and next-use, block optimization, a simple code
   generator and a peephole optimizer. Every transform can be checked by running
   the old and new code on the same random inputs. */
(function (DT) {
  'use strict';
  const isNum = (s) => typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s);
  const REL = ['<', '<=', '>', '>=', '==', '!='];
  const NOT_REL = { '<': '>=', '<=': '>', '>': '<=', '>=': '<', '==': '!=', '!=': '==' };
  const ARITH = ['+', '-', '*', '/', '%'];
  const COMMUTES = new Set(['+', '*', '==', '!=']);
  const isTempName = (v) => /^t\d+$/.test(v);
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const subscript = (n) => String(n).replace(/\d/g, (d) => SUB[d]);

  // ---------- parsing ----------
  function tokenize(s) {
    const out = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(:=|<=|>=|==|!=|[-+*/%<>=()[\]!,]))/y;
    let i = 0;
    while (i < s.length) {
      if (/^\s*$/.test(s.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) throw new Error(`Cannot read "${s.slice(i).trim()}".`);
      out.push(m[1] ?? m[2] ?? (m[3] === ':=' ? '=' : m[3]));
      i = re.lastIndex;
    }
    return out;
  }
  const KEYWORDS = new Set(['if', 'iffalse', 'goto', 'minus', 'not']);
  function parseExpr(toks, pos = 0) {
    let p = pos;
    const peek = () => toks[p];
    const eat = (t) => { if (toks[p] !== t) throw new Error(`Expected "${t}"${toks[p] ? ` but found "${toks[p]}"` : ' at the end'}.`); p++; };
    function primary() {
      const t = peek();
      if (t === undefined) throw new Error('An expression ends too early.');
      if (t === '(') { p++; const e = rel(); eat(')'); return e; }
      if (isNum(t)) { p++; return { k: 'num', v: t }; }
      if (/^[A-Za-z_]/.test(t) && !KEYWORDS.has(t.toLowerCase())) {
        p++;
        if (peek() === '[') { p++; const i = rel(); eat(']'); return { k: 'idx', arr: t, i }; }
        return { k: 'id', v: t };
      }
      throw new Error(`Unexpected "${t}".`);
    }
    function unary() {
      const t = peek();
      if (t === '-' || (t && t.toLowerCase() === 'minus')) {
        p++; const a = unary();
        if (a.k === 'num') return { k: 'num', v: a.v.startsWith('-') ? a.v.slice(1) : '-' + a.v };
        return { k: 'un', op: 'minus', a };
      }
      if (t === '!' || (t && t.toLowerCase() === 'not')) { p++; return { k: 'un', op: 'not', a: unary() }; }
      return primary();
    }
    function mul() { let l = unary(); while (['*', '/', '%'].includes(peek())) { const op = toks[p++]; l = { k: 'bin', op, l, r: unary() }; } return l; }
    function add() { let l = mul(); while (['+', '-'].includes(peek())) { const op = toks[p++]; l = { k: 'bin', op, l, r: mul() }; } return l; }
    function rel() { const l = add(); if (REL.includes(peek())) { const op = toks[p++]; return { k: 'bin', op, l, r: add() }; } return l; }
    const e = rel();
    return { e, pos: p };
  }
  const fullExpr = (toks) => { const r = parseExpr(toks); if (r.pos !== toks.length) throw new Error(`Unexpected "${toks[r.pos]}".`); return r.e; };

  // Text → three-address program. Lines may be numbered "(3)", "3)" or "3." and may carry labels "L1:".
  // Complex right sides are broken up with new temporaries, as in Aho 6.2.
  function parseProgram(text) {
    const used = new Set((text.match(/[A-Za-z_]\w*/g) || []));
    let tn = 0;
    const newTemp = () => { let t; do t = 't' + ++tn; while (used.has(t)); used.add(t); return t; };
    const gen = new Set();
    const ins = [];
    const labelAt = new Map(), numAt = new Map();
    let pending = [], numbered = false, count = 0;
    const lines = text.split('\n').flatMap((l) => l.replace(/(\/\/|#).*$/, '').split(';'));
    const emit = (x) => { x.src = count; ins.push(x); return x; };
    const operand = (e) => {
      if (e.k === 'id') return e.v;
      if (e.k === 'num') return e.v;
      return emitInto(e, null);
    };
    // operands first, then the result name, so temporaries are numbered in evaluation order
    function emitInto(e, dst) {
      const name = () => { if (dst) return dst; const t = newTemp(); gen.add(t); return t; };
      let d;
      if (e.k === 'id' || e.k === 'num') emit({ k: 'copy', dst: (d = name()), a: e.v });
      else if (e.k === 'bin') { const a = operand(e.l), b = operand(e.r); emit({ k: 'bin', dst: (d = name()), op: e.op, a, b }); }
      else if (e.k === 'un') { const a = operand(e.a); emit({ k: 'un', dst: (d = name()), op: e.op, a }); }
      else if (e.k === 'idx') { const i = operand(e.i); emit({ k: 'load', dst: (d = name()), arr: e.arr, idx: i }); }
      return d;
    }
    const simple = (e) => e.k === 'id' || e.k === 'num' || ((e.k === 'bin') && ['id', 'num'].includes(e.l.k) && ['id', 'num'].includes(e.r.k)) || (e.k === 'un' && ['id', 'num'].includes(e.a.k)) || (e.k === 'idx' && ['id', 'num'].includes(e.i.k));
    const targetOf = (toks) => {
      let t = toks.join('');
      t = t.replace(/^\((.*)\)$/, '$1');
      if (!t) throw new Error('goto needs a target.');
      return t;
    };
    for (let raw of lines) {
      let s = raw.trim();
      if (!s) continue;
      const num = s.match(/^\((\d+)\)\s*|^(\d+)\s*[.):]\s*/);
      let userNum = null;
      if (num) { userNum = +(num[1] || num[2]); numbered = true; s = s.slice(num[0].length); }
      let lm;
      while ((lm = s.match(/^([A-Za-z_]\w*)\s*:(?!=)\s*/)) && !KEYWORDS.has(lm[1].toLowerCase())) { pending.push(lm[1]); s = s.slice(lm[0].length); }
      if (!s) continue;
      count++;
      const startIdx = ins.length;
      const toks = tokenize(s);
      const low = (toks[0] || '').toLowerCase();
      try {
        if (low === 'goto') emit({ k: 'goto', target: targetOf(toks.slice(1)) });
        else if (low === 'if' || low === 'iffalse') {
          const g = toks.findIndex((t) => t.toLowerCase() === 'goto');
          if (g < 0) throw new Error('"if" needs "goto".');
          let c = toks.slice(1, g);
          const e = fullExpr(c);
          let x;
          if (e.k === 'bin' && REL.includes(e.op)) x = { k: 'if', a: operand(e.l), rel: e.op, b: operand(e.r) };
          else x = { k: 'if', a: operand(e), rel: '!=', b: '0' };
          if (low === 'iffalse') x.rel = NOT_REL[x.rel];
          x.target = targetOf(toks.slice(g + 1));
          emit(x);
        } else {
          const eq = toks.indexOf('=');
          if (eq < 1) throw new Error('Expected an assignment "x = …", "goto L" or "if … goto L".');
          const lhs = toks.slice(0, eq), rhs = fullExpr(toks.slice(eq + 1));
          if (lhs.length === 1 && /^[A-Za-z_]/.test(lhs[0]) && !KEYWORDS.has(lhs[0].toLowerCase())) {
            if (simple(rhs)) emitInto(rhs, lhs[0]);
            else { const t = operand(rhs); emit({ k: 'copy', dst: lhs[0], a: t }); }
          } else if (lhs.length >= 4 && lhs[1] === '[' && lhs[lhs.length - 1] === ']') {
            const idx = operand(fullExpr(lhs.slice(2, -1)));
            const a = operand(rhs);
            emit({ k: 'store', arr: lhs[0], idx, a });
          } else throw new Error(`Cannot assign to "${lhs.join(' ')}".`);
        }
      } catch (e) { throw new Error(`Line "${raw.trim()}": ${e.message}`); }
      for (const L of pending) labelAt.set(L, startIdx);
      pending = [];
      numAt.set(userNum ?? count, startIdx);
      if (userNum === null && numbered) numAt.set(count, startIdx);
    }
    for (const L of pending) labelAt.set(L, ins.length);
    const lastNum = Math.max(0, ...numAt.keys());
    for (const x of ins) {
      if (!x.target) continue;
      if (labelAt.has(x.target)) { x.ti = labelAt.get(x.target); x.label = x.target; }
      else if (/^\d+$/.test(x.target)) {
        const n = +x.target;
        if (numAt.has(n)) x.ti = numAt.get(n);
        else if (n === lastNum + 1) x.ti = ins.length;
        else throw new Error(`goto (${n}): there is no instruction ${n}.`);
      } else throw new Error(`goto ${x.target}: label ${x.target} is not defined.`);
      delete x.target;
    }
    if (!ins.length) throw new Error('Write at least one statement.');
    return { ins, gen, lowered: ins.length !== count, names: used };
  }

  // ---------- printing ----------
  const defOf = (x) => (x.k === 'bin' || x.k === 'un' || x.k === 'copy' || x.k === 'load' ? x.dst : null);
  function usesOf(x) {
    const u = [];
    const add = (v) => { if (v != null && !isNum(v) && !u.includes(v)) u.push(v); };
    if (x.k === 'bin') { add(x.a); add(x.b); } else if (x.k === 'un' || x.k === 'copy') add(x.a);
    else if (x.k === 'load') add(x.idx); else if (x.k === 'store') { add(x.idx); add(x.a); } else if (x.k === 'if') { add(x.a); add(x.b); }
    return u;
  }
  const condStr = (x) => (x.rel === '!=' && x.b === '0' ? x.a : `${x.a} ${x.rel} ${x.b}`);
  function insStr(x, T = (y) => `(${y.ti + 1})`) {
    switch (x.k) {
      case 'bin': return `${x.dst} = ${x.a} ${x.op} ${x.b}`;
      case 'un': return `${x.dst} = ${x.op === 'minus' ? 'minus ' : 'not '}${x.a}`;
      case 'copy': return `${x.dst} = ${x.a}`;
      case 'load': return `${x.dst} = ${x.arr}[${x.idx}]`;
      case 'store': return `${x.arr}[${x.idx}] = ${x.a}`;
      case 'if': return `if ${condStr(x)} goto ${T(x)}`;
      case 'goto': return `goto ${T(x)}`;
      case 'phi': return `${x.dst} = φ(${x.args.map((a) => a.name).join(', ')})`;
    }
    return '?';
  }
  const isJump = (x) => x.k === 'if' || x.k === 'goto';

  // ---------- interpreter (for checking transforms) ----------
  function rnd(seed, key) {
    let h = 2166136261 ^ seed;
    for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return ((h >>> 0) % 9) + 1;
  }
  function arith(op, a, b) {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': return b === 0 ? 0 : a / b; case '%': return b === 0 ? 0 : a % b;
      case '<': return +(a < b); case '<=': return +(a <= b); case '>': return +(a > b);
      case '>=': return +(a >= b); case '==': return +(a === b); case '!=': return +(a !== b);
    }
    throw new Error('bad operator ' + op);
  }
  const unop = (op, a) => (op === 'minus' ? -a : +(!a));
  function machine(seed) {
    const env = new Map(), mem = new Map();
    const val = (v) => (isNum(v) ? +v : env.has(v) ? env.get(v) : rnd(seed, v));
    const aget = (a, i) => { const k = a + '[' + i + ']'; return mem.has(k) ? mem.get(k) : rnd(seed, k); };
    return { env, mem, val, aget, aset: (a, i, v) => mem.set(a + '[' + i + ']', v) };
  }
  function step(M, x) {
    switch (x.k) {
      case 'bin': M.env.set(x.dst, arith(x.op, M.val(x.a), M.val(x.b))); break;
      case 'un': M.env.set(x.dst, unop(x.op, M.val(x.a))); break;
      case 'copy': M.env.set(x.dst, M.val(x.a)); break;
      case 'load': M.env.set(x.dst, M.aget(x.arr, M.val(x.idx))); break;
      case 'store': M.aset(x.arr, M.val(x.idx), M.val(x.a)); break;
      case 'if': return arith(x.rel, M.val(x.a), M.val(x.b)) ? 'jump' : 'next';
      case 'goto': return 'jump';
    }
    return 'next';
  }
  function run(ins, seed, limit = 20000) {
    const M = machine(seed);
    let pc = 0, n = 0;
    while (pc < ins.length) {
      if (++n > limit) return { M, timeout: true };
      const x = ins[pc];
      pc = step(M, x) === 'jump' ? x.ti : pc + 1;
    }
    return { M };
  }
  // what the outside world sees: every non-temporary scalar and every array cell
  function observe(M, names, seed) {
    const o = {};
    for (const v of names) o[v] = M.env.has(v) ? M.env.get(v) : rnd(seed, v);
    for (const [k, v] of M.mem) o[k] = v;
    return o;
  }
  const visible = (ins, extra = []) => {
    const s = new Set(extra);
    for (const x of ins) { const d = defOf(x); if (d) s.add(d); usesOf(x).forEach((u) => s.add(u)); }
    return [...s].filter((v) => !isTempName(v));
  };
  function sameObs(a, b, seed) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const va = k in a ? a[k] : rnd(seed, k), vb = k in b ? b[k] : rnd(seed, k);
      if (Math.abs(va - vb) > 1e-9 && !(Number.isNaN(va) && Number.isNaN(vb))) return k;
    }
    return null;
  }
  // run two linear programs on the same inputs; temporaries (t1, t2, …) are not compared
  function equivalent(ins1, ins2, opts = {}) {
    const names = opts.names || visible([...ins1, ...ins2], opts.extra);
    const runs = opts.runs || 40;
    let checked = 0;
    for (let s = 1; s <= runs; s++) {
      const r1 = run(ins1, s), r2 = run(ins2, s);
      if (r1.timeout || r2.timeout) { if (r1.timeout !== r2.timeout) return { ok: false, seed: s, what: 'one version does not stop' }; continue; }
      const diff = sameObs(observe(r1.M, names, s), observe(r2.M, names, s), s);
      if (diff) return { ok: false, seed: s, what: diff };
      checked++;
    }
    return { ok: true, runs: checked };
  }

  // ---------- basic blocks and flow graph ----------
  function basicBlocks(ins) {
    const n = ins.length;
    const why = new Map();
    const add = (i, r) => { if (i < n) { if (!why.has(i)) why.set(i, []); if (!why.get(i).includes(r)) why.get(i).push(r); } };
    add(0, 'first instruction');
    ins.forEach((x, i) => {
      if (!isJump(x)) return;
      add(x.ti, `target of the jump at (${i + 1})`);
      add(i + 1, `follows the jump at (${i + 1})`);
    });
    const leaders = [...why.keys()].sort((a, b) => a - b);
    const blocks = leaders.map((s, k) => ({ id: k, start: s, end: k + 1 < leaders.length ? leaders[k + 1] : n, succ: [], pred: [] }));
    const blockOf = new Array(n);
    blocks.forEach((b) => { for (let i = b.start; i < b.end; i++) blockOf[i] = b.id; });
    const EXIT = blocks.length;
    const bAt = (i) => (i >= n ? EXIT : blockOf[i]);
    for (const b of blocks) {
      const last = ins[b.end - 1];
      const s = [];
      if (last.k === 'goto') s.push(bAt(last.ti));
      else if (last.k === 'if') { s.push(bAt(last.ti)); s.push(bAt(b.end)); } else s.push(bAt(b.end));
      b.succ = [...new Set(s)];
    }
    for (const b of blocks) for (const s of b.succ) if (s !== EXIT) blocks[s].pred.push(b.id);
    for (const b of blocks) b.ins = ins.slice(b.start, b.end);
    return { blocks, leaders, why, blockOf, EXIT, bAt };
  }
  const blockTarget = (bb) => (x) => (bb.bAt(x.ti) === bb.EXIT ? 'EXIT' : 'B' + (bb.bAt(x.ti) + 1));

  // dominators over ENTRY (index n) + blocks 0..n-1
  function dominators(bb) {
    const B = bb.blocks, n = B.length, ENTRY = n + 1;
    const preds = (i) => (i === 0 ? [ENTRY, ...B[0].pred] : B[i].pred);
    const all = new Set([...B.keys(), ENTRY]);
    const dom = B.map(() => new Set(all));
    const reach = new Set([0]);
    const st = [0];
    while (st.length) { const u = st.pop(); for (const v of B[u].succ) if (v < n && !reach.has(v)) { reach.add(v); st.push(v); } }
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (!reach.has(i)) continue;
        let s = null;
        for (const p of preds(i)) {
          if (p !== ENTRY && !reach.has(p)) continue;
          const dp = p === ENTRY ? new Set([ENTRY]) : dom[p];
          s = s === null ? new Set(dp) : new Set([...s].filter((x) => dp.has(x)));
        }
        s = s || new Set();
        s.add(i);
        if (s.size !== dom[i].size || [...s].some((x) => !dom[i].has(x))) { dom[i] = s; changed = true; }
      }
    }
    const idom = B.map((_, i) => {
      if (!reach.has(i)) return null;
      const strict = [...dom[i]].filter((d) => d !== i);
      return strict.find((d) => strict.every((e) => e === d || (d === ENTRY ? false : dom[d].has(e)))) ?? ENTRY;
    });
    // back edges and natural loops
    const loops = [];
    for (const b of B) for (const h of b.succ) {
      if (h < n && reach.has(b.id) && dom[b.id].has(h)) {
        const body = new Set([h, b.id]);
        const stack = b.id === h ? [] : [b.id];
        while (stack.length) { const m = stack.pop(); for (const p of B[m].pred) if (!body.has(p)) { body.add(p); stack.push(p); } }
        loops.push({ from: b.id, head: h, body: [...body].sort((x, y) => x - y) });
      }
    }
    return { dom, idom, ENTRY, reach, loops, preds };
  }

  // ---------- liveness ----------
  function arraysOf(ins) { const s = new Set(); for (const x of ins) if (x.arr) s.add(x.arr); return s; }
  function liveness(bb, exitLive) {
    const B = bb.blocks;
    const use = [], def = [];
    for (const b of B) {
      const u = new Set(), d = new Set();
      for (const x of b.ins) { for (const v of usesOf(x)) if (!d.has(v)) u.add(v); const t = defOf(x); if (t) d.add(t); }
      use.push(u); def.push(d);
    }
    let IN = B.map(() => new Set()), OUT = B.map(() => new Set());
    const passes = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = B.length - 1; i >= 0; i--) {
        const o = new Set();
        for (const s of B[i].succ) (s === bb.EXIT ? exitLive : IN[s]).forEach((v) => o.add(v));
        const inn = new Set(use[i]);
        o.forEach((v) => { if (!def[i].has(v)) inn.add(v); });
        if (o.size !== OUT[i].size || inn.size !== IN[i].size) changed = true;
        OUT[i] = o; IN[i] = inn;
      }
      passes.push({ IN: IN.map((s) => new Set(s)), OUT: OUT.map((s) => new Set(s)) });
    }
    return { use, def, IN, OUT, passes };
  }
  const exitLiveOf = (prog) => (prog.liveExit ? new Set(prog.liveExit) : new Set(visible(prog.ins).filter((v) => !prog.gen.has(v))));
  // names whose final values must be preserved (arrays are always compared)
  const observedOf = (prog) => [...exitLiveOf(prog)];

  // Aho Algorithm 8.7: next-use information inside one block, scanning backwards
  function nextUse(insList, liveOut, base = 0) {
    const state = new Map();
    const names = new Set(liveOut);
    for (const x of insList) { const d = defOf(x); if (d) names.add(d); usesOf(x).forEach((u) => names.add(u)); }
    for (const v of names) state.set(v, liveOut.has(v) ? { live: true, next: null } : { live: false, next: null });
    const initial = new Map([...state].map(([k, v]) => [k, { ...v }]));
    const rows = new Array(insList.length), after = new Array(insList.length);
    for (let i = insList.length - 1; i >= 0; i--) {
      const x = insList[i];
      after[i] = new Map([...state].map(([k, v]) => [k, { ...v }]));
      const info = {};
      const d = defOf(x);
      if (d) info[d] = { ...state.get(d) };
      for (const u of usesOf(x)) info[u] = { ...state.get(u) };
      rows[i] = info;
      if (d) state.set(d, { live: false, next: null });
      for (const u of usesOf(x)) state.set(u, { live: true, next: base + i });
    }
    return { rows, after, initial, atStart: state };
  }

  // ---------- DAG for a basic block (value numbers) ----------
  function blockDAG(insList, opts = {}) {
    const nodes = [], cur = new Map(), leafOf = new Map(), constOf = new Map(), table = new Map();
    const steps = [];
    const gen = opts.gen || new Set();
    const fold = opts.fold !== false;
    const mkNode = (o) => { o.id = nodes.length; o.ids = []; nodes.push(o); return o.id; };
    const constNode = (c) => { const k = String(+c); if (!constOf.has(k)) constOf.set(k, mkNode({ kind: 'const', label: k })); return constOf.get(k); };
    const get = (v) => {
      if (isNum(v)) return constNode(v);
      if (cur.has(v)) return cur.get(v);
      if (!leafOf.has(v)) leafOf.set(v, mkNode({ kind: 'leaf', label: v }));
      return leafOf.get(v);
    };
    const attach = (v, id) => {
      if (cur.has(v)) { const o = nodes[cur.get(v)]; o.ids = o.ids.filter((x) => x !== v); }
      nodes[id].ids.push(v); cur.set(v, id);
    };
    const isConst = (id) => nodes[id].kind === 'const';
    const cval = (id) => +nodes[id].label;
    const find = (op, kids) => {
      const k = op + '|' + kids.join(',');
      if (table.has(k) && !nodes[table.get(k)].killed) return { id: table.get(k), comm: false };
      if (COMMUTES.has(op) && kids.length === 2) {
        const k2 = op + '|' + [kids[1], kids[0]].join(',');
        if (table.has(k2) && !nodes[table.get(k2)].killed) return { id: table.get(k2), comm: true };
      }
      return null;
    };
    const interior = (op, kids, extra = {}) => {
      const f = find(op, kids);
      if (f) return { id: f.id, reused: true, comm: f.comm };
      const id = mkNode({ kind: 'op', op, kids, ...extra });
      table.set(op + '|' + kids.join(','), id);
      return { id, reused: false };
    };
    let jump = null;
    insList.forEach((x, i) => {
      const n = (opts.base || 0) + i + 1;
      const S = { n, text: insStr(x, opts.T), note: '' };
      if (x.k === 'bin') {
        const l = get(x.a), r = get(x.b);
        let id = null;
        if (fold && isConst(l) && isConst(r)) { id = constNode(String(arith(x.op, cval(l), cval(r)))); S.note = `constant folding: ${x.a} ${x.op} ${x.b} = ${nodes[id].label}`; S.kind = 'fold'; }
        else if (fold && ((x.op === '+' && isConst(r) && cval(r) === 0) || (x.op === '-' && isConst(r) && cval(r) === 0) || ((x.op === '*' || x.op === '/') && isConst(r) && cval(r) === 1))) { id = l; S.note = `identity: ${x.a} ${x.op} ${x.b} is just ${x.a}`; S.kind = 'identity'; }
        else if (fold && ((x.op === '+' && isConst(l) && cval(l) === 0) || (x.op === '*' && isConst(l) && cval(l) === 1))) { id = r; S.note = `identity: ${x.a} ${x.op} ${x.b} is just ${x.b}`; S.kind = 'identity'; }
        else {
          const r2 = interior(x.op, [l, r]);
          id = r2.id;
          if (r2.reused) { S.note = `node ${id} already computes this${r2.comm ? ' (operands swapped, and ' + x.op + ' commutes)' : ''}: common subexpression`; S.kind = 'cse'; } else { S.note = `new node ${id}: ${x.op}(${l}, ${r})`; S.kind = 'new'; }
        }
        attach(x.dst, id); S.node = id;
      } else if (x.k === 'un') {
        const a = get(x.a);
        let id;
        if (fold && isConst(a)) { id = constNode(String(unop(x.op, cval(a)))); S.note = `constant folding: ${x.op} ${x.a} = ${nodes[id].label}`; S.kind = 'fold'; }
        else { const r2 = interior(x.op, [a]); id = r2.id; S.note = r2.reused ? `node ${id} already computes this: common subexpression` : `new node ${id}: ${x.op}(${a})`; S.kind = r2.reused ? 'cse' : 'new'; }
        attach(x.dst, id); S.node = id;
      } else if (x.k === 'copy') {
        const id = get(x.a); attach(x.dst, id); S.node = id;
        S.note = `copy: ${x.dst} is attached to node ${id}, no new node`; S.kind = 'copy';
      } else if (x.k === 'load') {
        const arr = get(x.arr), i2 = get(x.idx);
        const r2 = interior('=[]', [arr, i2], { arr: x.arr });
        attach(x.dst, r2.id); S.node = r2.id;
        S.note = r2.reused ? `node ${r2.id} already loads ${x.arr}[${x.idx}] and ${x.arr} has not been written since: common subexpression` : `new node ${r2.id}: =[](${arr}, ${i2})`; S.kind = r2.reused ? 'cse' : 'new';
      } else if (x.k === 'store') {
        const arr = get(x.arr), i2 = get(x.idx), a = get(x.a);
        let killed = 0;
        for (const o of nodes) if (o.kind === 'op' && o.op === '=[]' && o.arr === x.arr && !o.killed) { o.killed = true; killed++; }
        const id = mkNode({ kind: 'op', op: '[]=', kids: [arr, i2, a], arr: x.arr, store: true });
        S.node = id; S.kind = 'new';
        S.note = `new node ${id}: []=(${arr}, ${i2}, ${a})${killed ? `; it kills ${killed} earlier load${killed > 1 ? 's' : ''} from ${x.arr}, which can no longer be reused` : ''}`;
      } else if (isJump(x)) {
        jump = { x, a: x.k === 'if' ? get(x.a) : null, b: x.k === 'if' ? get(x.b) : null };
        S.note = 'the jump stays at the end of the block'; S.kind = 'jump';
      }
      steps.push(S);
    });
    return { nodes, cur, leafOf, steps, jump, gen };
  }

  // rebuild code from the DAG (Aho 8.5.7): one instruction per needed node,
  // dead names dropped, common subexpressions computed once
  function rebuildBlock(dag, liveOut, freshTemp) {
    const { nodes, cur, jump } = dag;
    const finalOf = new Map(cur);
    const liveIds = (o) => o.ids.filter((v) => liveOut.has(v));
    const needed = new Set();
    const mark = (id) => { if (needed.has(id)) return; needed.add(id); (nodes[id].kids || []).forEach(mark); };
    for (const o of nodes) {
      if (o.store) mark(o.id);
      if (liveIds(o).length) mark(o.id);
    }
    if (jump && jump.a !== null) { mark(jump.a); mark(jump.b); }
    const order = nodes.filter((o) => needed.has(o.id) && o.kind === 'op');
    // which nodes are still read at or after position k
    const users = new Map(nodes.map((o) => [o.id, []]));
    order.forEach((o, k) => o.kids.forEach((c) => users.get(c).push(k)));
    const END = order.length;
    if (jump && jump.a !== null) { users.get(jump.a).push(END); users.get(jump.b).push(END); }
    for (const o of nodes) if (o.kind !== 'op' && liveIds(o).some((v) => v !== o.label || finalOf.get(v) !== o.id)) users.get(o.id).push(END);
    const holders = new Map(nodes.map((o) => [o.id, new Set(o.kind === 'leaf' ? [o.label] : [])]));
    const nameOf = (id) => (nodes[id].kind === 'const' ? nodes[id].label : [...holders.get(id)].sort((a, b) => isTempName(a) - isTempName(b))[0]);
    const out = [];
    const dropped = [];
    const write = (X, k) => {
      for (const o of nodes) {
        const h = holders.get(o.id);
        if (!h.has(X)) continue;
        h.delete(X);
        if (!h.size && users.get(o.id).some((u) => u >= k) && o.kind !== 'const') {
          const live = liveIds(o).find((v) => v !== X && ![...holders.values()].some((s) => s.has(v)));
          const t = live || freshTemp();
          out.push({ k: 'copy', dst: t, a: X });
          h.add(t);
        }
      }
    };
    order.forEach((o, k) => {
      if (o.store) {
        out.push({ k: 'store', arr: o.arr, idx: nameOf(o.kids[1]), a: nameOf(o.kids[2]) });
        return;
      }
      const live = liveIds(o);
      const tempIds = o.ids.filter((v) => !liveOut.has(v) && isTempName(v));
      const X = live[0] || tempIds[0] || freshTemp();
      const args = o.kids.map(nameOf);
      write(X, k + 1);
      let x;
      if (o.op === '=[]') x = { k: 'load', dst: X, arr: o.arr, idx: args[1] };
      else if (o.op === 'minus' || o.op === 'not') x = { k: 'un', dst: X, op: o.op, a: args[0] };
      else x = { k: 'bin', dst: X, op: o.op, a: args[0], b: args[1] };
      out.push(x);
      holders.get(o.id).add(X);
      for (const v of live.slice(1)) { write(v, k + 1); out.push({ k: 'copy', dst: v, a: X }); holders.get(o.id).add(v); }
    });
    // live names attached to leaves or constants
    for (const o of nodes) {
      if (o.kind === 'op') continue;
      for (const v of liveIds(o)) {
        if (holders.get(o.id).has(v)) continue;
        const a = nameOf(o.id);
        write(v, END);
        out.push({ k: 'copy', dst: v, a });
        holders.get(o.id).add(v);
      }
    }
    for (const o of nodes) for (const v of o.ids) if (!liveOut.has(v) && !out.some((x) => defOf(x) === v)) dropped.push(v);
    if (jump) {
      const j = { ...jump.x };
      if (j.k === 'if') { j.a = nameOf(jump.a); j.b = nameOf(jump.b); }
      out.push(j);
    }
    return { code: out, dropped: [...new Set(dropped)] };
  }

  // optimize every block of a program and stitch it back together
  function optimize(prog) {
    const bb = basicBlocks(prog.ins);
    const exitLive = exitLiveOf(prog);
    const lv = liveness(bb, exitLive);
    let tn = 0;
    const used = new Set(prog.names);
    prog.ins.forEach((x) => { const d = defOf(x); if (d) used.add(d); });
    const freshTemp = () => { let t; do t = 't' + ++tn; while (used.has(t)); used.add(t); return t; };
    const T = blockTarget(bb);
    const per = bb.blocks.map((b, k) => {
      const dag = blockDAG(b.ins, { base: b.start, T, gen: prog.gen });
      const rb = rebuildBlock(dag, lv.OUT[k], freshTemp);
      return { dag, ...rb, before: b.ins, liveOut: lv.OUT[k] };
    });
    // flatten: jumps point at the start of their target block
    const starts = [];
    let pos = 0;
    per.forEach((p) => { starts.push(pos); pos += p.code.length; });
    const ins = [];
    per.forEach((p) => p.code.forEach((x) => {
      const y = { ...x };
      if (isJump(y)) { const tb = bb.bAt(x.ti); y.ti = tb === bb.EXIT ? pos : starts[tb]; }
      ins.push(y);
    }));
    return { bb, lv, per, ins, starts, exitLive };
  }

  // ---------- quadruples, triples, indirect triples ----------
  function representations(prog) {
    const T = (x) => `(${x.ti + 1})`;
    const quads = prog.ins.map((x) => {
      switch (x.k) {
        case 'bin': return [x.op, x.a, x.b, x.dst];
        case 'un': return [x.op, x.a, '', x.dst];
        case 'copy': return ['=', x.a, '', x.dst];
        case 'load': return ['=[]', x.arr, x.idx, x.dst];
        case 'store': return ['[]=', x.a, x.idx, x.arr];
        case 'if': return x.rel === '!=' && x.b === '0' ? ['if', x.a, '', T(x)] : ['if ' + x.rel, x.a, x.b, T(x)];
        case 'goto': return ['goto', '', '', T(x)];
      }
      return [];
    });
    // triples: a temporary defined once and used later becomes a reference to its triple
    const defCount = new Map();
    prog.ins.forEach((x) => { const d = defOf(x); if (d) defCount.set(d, (defCount.get(d) || 0) + 1); });
    const asRef = (v) => isTempName(v) && defCount.get(v) === 1;
    const triples = [], firstTriple = [];
    const ref = new Map();
    const arg = (v) => (ref.has(v) ? `(${ref.get(v)})` : v);
    const pending = [];
    prog.ins.forEach((x) => {
      firstTriple.push(triples.length);
      const push = (t) => { triples.push(t); return triples.length - 1; };
      const result = (k) => { if (asRef(x.dst)) ref.set(x.dst, k); else push(['=', x.dst, `(${k})`]); };
      switch (x.k) {
        case 'bin': result(push([x.op, arg(x.a), arg(x.b)])); break;
        case 'un': result(push([x.op, arg(x.a), ''])); break;
        case 'copy': if (asRef(x.dst) && ref.has(x.a)) ref.set(x.dst, ref.get(x.a)); else push(['=', x.dst, arg(x.a)]); break;
        case 'load': result(push(['=[]', x.arr, arg(x.idx)])); break;
        case 'store': { const k = push(['[]=', x.arr, arg(x.idx)]); push(['=', `(${k})`, arg(x.a)]); break; }
        case 'if': { const k = push([x.rel === '!=' && x.b === '0' ? 'if' : 'if ' + x.rel, arg(x.a), x.rel === '!=' && x.b === '0' ? '' : arg(x.b), null]); pending.push([k, x.ti]); break; }
        case 'goto': { const k = push(['goto', '', '', null]); pending.push([k, x.ti]); break; }
      }
    });
    for (const [k, ti] of pending) triples[k][3] = `(${ti < firstTriple.length ? firstTriple[ti] : triples.length})`;
    // jumps: show the target in the last column
    const tri2 = triples.map((t) => (t.length > 3 ? [t[0], t[1], t[2] ? `${t[2]}` : '', t[3]] : [...t, '']));
    return { quads, triples: tri2, indirect: tri2.map((_, i) => 35 + i) };
  }

  // ---------- SSA ----------
  function toSSA(prog) {
    const bb = basicBlocks(prog.ins);
    const B = bb.blocks, n = B.length;
    const D = dominators(bb);
    const ENTRY = D.ENTRY;
    // dominance frontiers (Cooper, Harvey, Kennedy)
    const DF = B.map(() => new Set());
    for (let b = 0; b < n; b++) {
      if (!D.reach.has(b)) continue;
      const ps = D.preds(b).filter((p) => p === ENTRY || D.reach.has(p));
      if (ps.length < 2) continue;
      for (const p of ps) {
        let r = p;
        while (r !== ENTRY && r !== D.idom[b]) { DF[r].add(b); r = D.idom[r]; }
      }
    }
    const defCount = new Map(), defsites = new Map(), globals = new Set();
    B.forEach((b, i) => {
      const killed = new Set();
      for (const x of b.ins) {
        usesOf(x).forEach((u) => { if (!killed.has(u)) globals.add(u); });
        const d = defOf(x);
        if (d) { killed.add(d); defCount.set(d, (defCount.get(d) || 0) + 1); if (!defsites.has(d)) defsites.set(d, new Set()); defsites.get(d).add(i); }
      }
    });
    // pruned SSA: a φ only where the name is live on entry
    const lv = liveness(bb, exitLiveOf(prog));
    const phis = B.map(() => []);
    for (const [v, sites] of defsites) {
      if (!globals.has(v)) continue;
      const work = [...sites], has = new Set(), seen = new Set(sites);
      while (work.length) {
        const d = work.pop();
        for (const y of DF[d]) {
          if (has.has(y) || !lv.IN[y].has(v)) continue;
          has.add(y);
          phis[y].push({ k: 'phi', v, dst: v, args: D.preds(y).filter((p) => p === ENTRY || D.reach.has(p)).map((p) => ({ from: p, name: v })) });
          if (!seen.has(y)) { seen.add(y); work.push(y); }
        }
      }
    }
    const rename = new Set([...defCount].filter(([v, c]) => c > 1).map(([v]) => v));
    phis.forEach((ps) => ps.forEach((p) => rename.add(p.v)));
    const count = new Map(), stack = new Map(), origin = new Map();
    const top = (v) => (rename.has(v) ? ((stack.get(v) || []).slice(-1)[0] || v) : v);
    const fresh = (v) => { if (!rename.has(v)) return v; const c = (count.get(v) || 0) + 1; count.set(v, c); const nm = v + subscript(c); origin.set(nm, v); if (!stack.has(v)) stack.set(v, []); stack.get(v).push(nm); return nm; };
    const children = new Map();
    B.forEach((_, i) => { const p = D.idom[i]; if (p === null) return; if (!children.has(p)) children.set(p, []); children.get(p).push(i); });
    const out = B.map(() => null);
    const succOf = (i) => (i === ENTRY ? [0] : B[i].succ.filter((s) => s < n));
    const walk = (i) => {
      const pushed = [];
      if (i !== ENTRY) {
        const ps = phis[i].map((p) => { p.dst = fresh(p.v); if (rename.has(p.v)) pushed.push(p.v); return p; });
        const body = B[i].ins.map((x) => {
          const y = { ...x };
          if ('a' in y && y.a != null) y.a = top(y.a);
          if ('b' in y && y.b != null) y.b = top(y.b);
          if ('idx' in y) y.idx = top(y.idx);
          const d = defOf(x);
          if (d) { y.dst = fresh(d); if (rename.has(d)) pushed.push(d); }
          return y;
        });
        out[i] = { phis: ps, ins: body };
      }
      for (const s of succOf(i)) for (const p of phis[s]) { const a = p.args.find((q) => q.from === i); if (a) a.name = top(p.v); }
      for (const c of children.get(i) || []) walk(c);
      for (const v of pushed) stack.get(v).pop();
    };
    walk(ENTRY);
    B.forEach((b, i) => { if (!out[i]) out[i] = { phis: [], ins: b.ins.map((x) => ({ ...x })), unreachable: true }; });
    // check: every name is assigned once
    const assigned = new Map();
    out.forEach((b) => [...b.phis, ...b.ins].forEach((x) => { const d = x.k === 'phi' ? x.dst : defOf(x); if (d) assigned.set(d, (assigned.get(d) || 0) + 1); }));
    const single = [...assigned.values()].every((c) => c === 1);
    return { bb, D, DF, blocks: out, rename, origin, single, phiCount: phis.reduce((s, p) => s + p.length, 0), ENTRY };
  }
  // run SSA blocks: φ picks the operand for the edge it came in on
  function runSSA(ssa, seed, limit = 20000) {
    const { bb } = ssa;
    const M = machine(seed);
    const last = new Map();
    let b = 0, from = ssa.ENTRY, steps = 0;
    while (b !== bb.EXIT && b < ssa.blocks.length) {
      const blk = ssa.blocks[b];
      const vals = blk.phis.map((p) => { const a = p.args.find((q) => q.from === from); return M.val(a ? a.name : p.v); });
      blk.phis.forEach((p, k) => { M.env.set(p.dst, vals[k]); last.set(p.v, p.dst); });
      let next = b + 1 < ssa.blocks.length ? b + 1 : bb.EXIT;
      for (const x of blk.ins) {
        if (++steps > limit) return { M, last, timeout: true };
        const r = step(M, x);
        const d = defOf(x);
        if (d) last.set(ssa.origin.get(d) || d, d);
        if (r === 'jump') { next = bb.bAt(x.ti); break; }
      }
      from = b; b = next;
    }
    return { M, last };
  }
  function checkSSA(prog, ssa, runs = 40) {
    const names = observedOf(prog);
    let checked = 0;
    for (let s = 1; s <= runs; s++) {
      const r1 = run(prog.ins, s), r2 = runSSA(ssa, s);
      if (r1.timeout || r2.timeout) continue;
      for (const v of names) {
        const a = r1.M.env.has(v) ? r1.M.env.get(v) : rnd(s, v);
        const nm = r2.last.get(v) || v;
        const b = r2.M.env.has(nm) ? r2.M.env.get(nm) : rnd(s, v);
        if (Math.abs(a - b) > 1e-9) return { ok: false, what: v, seed: s };
      }
      checked++;
    }
    return { ok: true, runs: checked };
  }

  // ---------- target machine (Aho 8.2) ----------
  // LD R, x | LD R, #c | LD R, a(Ri) | ST x, R | ST a(Ri), R | OP Rd, Rs, Rt | NEG Rd, Rs
  // BR L | Bcc R, L | INC x. Cost = 1 + one per operand that is a memory address, a constant or a label.
  const OPN = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD', '<': 'LT', '<=': 'LE', '>': 'GT', '>=': 'GE', '==': 'EQ', '!=': 'NE' };
  const BR = { '<': 'BLTZ', '<=': 'BLEZ', '>': 'BGTZ', '>=': 'BGEZ', '==': 'BEQZ', '!=': 'BNEZ' };
  const opnd = (o) => (o.kind === 'reg' ? 'R' + o.r : o.kind === 'imm' ? '#' + o.v : o.kind === 'idx' ? `${o.arr}(R${o.r})` : o.name);
  function mStr(m) {
    switch (m.op) {
      case 'LD': return `LD R${m.d}, ${opnd(m.src)}`;
      case 'ST': return `ST ${opnd(m.dst)}, R${m.s}`;
      case 'NEG': return `NEG R${m.d}, R${m.s}`;
      case 'BR': return `BR ${m.L}`;
      case 'INC': return `INC ${m.name}`;
      case 'LABEL': return `${m.L}:`;
    }
    if (m.L) return `${m.op} R${m.s}, ${m.L}`;
    return `${m.op} R${m.d}, R${m.s}, R${m.t}`;
  }
  function mCost(m) {
    switch (m.op) {
      case 'LABEL': return 0;
      case 'LD': return m.src.kind === 'reg' ? 1 : 2;
      case 'ST': return 2;
      case 'BR': return 2;
      case 'INC': return 2;
      case 'NEG': return 1;
    }
    return m.L ? 2 : 1;
  }
  function runMachine(code, seed, limit = 40000) {
    const M = machine(seed);
    const R = [];
    const labels = new Map();
    code.forEach((m, i) => { if (m.op === 'LABEL') labels.set(m.L, i); });
    const rv = (r) => (R[r] === undefined ? 0 : R[r]);
    const src = (o) => (o.kind === 'imm' ? +o.v : o.kind === 'reg' ? rv(o.r) : o.kind === 'idx' ? M.aget(o.arr, rv(o.r)) : M.val(o.name));
    let pc = 0, n = 0;
    while (pc < code.length) {
      if (++n > limit) return { M, timeout: true };
      const m = code[pc];
      let next = pc + 1;
      switch (m.op) {
        case 'LABEL': break;
        case 'LD': R[m.d] = src(m.src); break;
        case 'ST': if (m.dst.kind === 'idx') M.aset(m.dst.arr, rv(m.dst.r), rv(m.s)); else M.env.set(m.dst.name, rv(m.s)); break;
        case 'NEG': R[m.d] = -rv(m.s); break;
        case 'INC': M.env.set(m.name, M.val(m.name) + 1); break;
        case 'BR': next = labels.has(m.L) ? labels.get(m.L) : code.length; break;
        default:
          if (m.L) {
            const v = rv(m.s);
            const t = { BLTZ: v < 0, BLEZ: v <= 0, BGTZ: v > 0, BGEZ: v >= 0, BEQZ: v === 0, BNEZ: v !== 0 }[m.op];
            if (t) next = labels.has(m.L) ? labels.get(m.L) : code.length;
          } else {
            const op = Object.keys(OPN).find((k) => OPN[k] === m.op);
            R[m.d] = arith(op, rv(m.s), rv(m.t));
          }
      }
      pc = next;
    }
    return { M };
  }
  function checkMachine(ins, code, runs = 40, names = visible(ins)) {
    let checked = 0;
    for (let s = 1; s <= runs; s++) {
      const r1 = run(ins, s), r2 = runMachine(code, s);
      if (r1.timeout || r2.timeout) continue;
      const d = sameObs(observe(r1.M, names, s), observe(r2.M, names, s), s);
      if (d) return { ok: false, what: d, seed: s };
      checked++;
    }
    return { ok: true, runs: checked };
  }

  // Aho 8.6: code generation with register and address descriptors and getReg
  function generate(prog, nRegs = 3) {
    nRegs = Math.max(2, Math.min(8, nRegs | 0 || 3));
    const bb = basicBlocks(prog.ins);
    const exitLive = exitLiveOf(prog);
    const lv = liveness(bb, exitLive);
    const L = (b) => (b === bb.EXIT ? 'EXIT' : 'B' + (b + 1));
    const code = [], rows = [];
    let total = 0;
    for (const b of bb.blocks) {
      code.push({ op: 'LABEL', L: L(b.id) });
      const nu = nextUse(b.ins, lv.OUT[b.id], b.start);
      const regs = Array.from({ length: nRegs }, () => new Set());
      const addr = new Map();
      const A = (v) => { if (!addr.has(v)) addr.set(v, new Set(['mem'])); return addr.get(v); };
      const liveAfter = (i, v) => { if (v.startsWith('#')) return false; const s = nu.after[i - b.start].get(v); return s ? s.live : lv.OUT[b.id].has(v); };
      b.ins.forEach((x, k) => {
        const i = b.start + k;
        const em = [];
        const emit = (m) => { em.push(m); };
        const key = (v) => (isNum(v) ? '#' + v : v);
        const where = (v) => regs.findIndex((s) => s.has(v));
        const unsafeIn = (r, x0, ops) => [...regs[r]].filter((u) => {
          if (u.startsWith('#')) return false;
          const a = A(u);
          if (a.has('mem') || [...a].some((l) => l !== 'R' + r)) return false;
          if (u === x0 && !ops.includes(u)) return false;
          return liveAfter(i, u);
        });
        const choose = (avoid, x0, ops) => {
          const empty = regs.findIndex((s, r) => !s.size && !avoid.includes(r));
          if (empty >= 0) return empty;
          let best = -1, bestCost = Infinity;
          regs.forEach((s, r) => { if (avoid.includes(r)) return; const c = unsafeIn(r, x0, ops).length; if (c < bestCost) { bestCost = c; best = r; } });
          return best;
        };
        const spill = (r, x0, ops) => {
          for (const u of unsafeIn(r, x0, ops)) { emit({ op: 'ST', dst: { kind: 'mem', name: u }, s: r, why: `spill ${u}` }); A(u).add('mem'); }
        };
        const clear = (r) => { for (const u of regs[r]) A(u).delete('R' + r); regs[r].clear(); };
        const ensure = (v, avoid, x0, ops) => {
          const kv = key(v);
          const at = where(kv);
          if (at >= 0) return at;
          // never evict another operand of this same instruction
          const busy = ops.filter((o) => key(o) !== kv).map((o) => where(key(o))).filter((r) => r >= 0);
          const r = choose([...new Set([...avoid, ...busy])], x0, ops);
          spill(r, x0, ops); clear(r);
          emit({ op: 'LD', d: r, src: kv.startsWith('#') ? { kind: 'imm', v } : { kind: 'mem', name: v } });
          regs[r].add(kv); A(kv).add('R' + r);
          return r;
        };
        const setOnly = (r, v) => {
          clear(r);
          for (const s of regs) s.delete(v);
          regs[r].add(v); addr.set(v, new Set(['R' + r]));
        };
        const pickX = (dst, ops, rOps, avoid) => {
          const only = regs.findIndex((s) => s.size === 1 && s.has(dst));
          if (only >= 0) return only;
          for (let q = 0; q < ops.length; q++) {
            const kv = key(ops[q]), r = rOps[q];
            if (regs[r].size === 1 && regs[r].has(kv) && !liveAfter(i, kv)) return r;
          }
          const r = choose(avoid, dst, ops);
          spill(r, dst, ops);
          return r;
        };
        if (x.k === 'bin' || x.k === 'un') {
          const ops = x.k === 'bin' ? [x.a, x.b] : [x.a];
          const ry = ensure(ops[0], [], x.dst, ops);
          const rz = ops.length > 1 ? ensure(ops[1], [ry], x.dst, ops) : null;
          const rOps = rz === null ? [ry] : [ry, rz];
          const rx = pickX(x.dst, ops, rOps, []);
          if (x.k === 'bin') emit({ op: OPN[x.op], d: rx, s: ry, t: rz });
          else if (x.op === 'minus') emit({ op: 'NEG', d: rx, s: ry });
          else { const r0 = ensure('0', [ry], x.dst, ops); emit({ op: 'EQ', d: rx, s: ry, t: r0 }); }
          setOnly(rx, x.dst);
        } else if (x.k === 'copy') {
          const ry = ensure(x.a, [], x.dst, [x.a]);
          for (const s of regs) s.delete(x.dst);
          regs[ry].add(x.dst); addr.set(x.dst, new Set(['R' + ry]));
        } else if (x.k === 'load') {
          const ri = ensure(x.idx, [], x.dst, [x.idx]);
          const rx = pickX(x.dst, [x.idx], [ri], []);
          emit({ op: 'LD', d: rx, src: { kind: 'idx', arr: x.arr, r: ri } });
          setOnly(rx, x.dst);
        } else if (x.k === 'store') {
          const ri = ensure(x.idx, [], null, [x.idx, x.a]);
          const ra = ensure(x.a, [ri], null, [x.idx, x.a]);
          emit({ op: 'ST', dst: { kind: 'idx', arr: x.arr, r: ri }, s: ra });
        }
        const lastOne = k === b.ins.length - 1;
        let cond = null;
        if (lastOne && x.k === 'if') {
          const ra = ensure(x.a, [], null, [x.a, x.b]);
          const zero = x.b === '0';
          const rb = zero ? null : ensure(x.b, [ra], null, [x.a, x.b]);
          cond = { ra, rb };
        }
        if (lastOne) {
          // store every live name whose current value is only in a register
          for (const v of [...lv.OUT[b.id]].sort()) {
            const a = addr.get(v);
            if (!a || a.has('mem')) continue;
            const r = [...a].map((l) => +l.slice(1))[0];
            emit({ op: 'ST', dst: { kind: 'mem', name: v }, s: r, why: `${v} is live on exit` });
            a.add('mem');
          }
          if (x.k === 'goto') emit({ op: 'BR', L: L(bb.bAt(x.ti)) });
          if (cond) {
            if (cond.rb !== null) emit({ op: 'SUB', d: cond.ra, s: cond.ra, t: cond.rb });
            emit({ op: BR[x.rel], s: cond.ra, L: L(bb.bAt(x.ti)) });
          }
        }
        const cost = em.reduce((s, m) => s + mCost(m), 0);
        total += cost;
        code.push(...em);
        const regText = regs.map((s, r) => `R${r}: ${[...s].join(', ') || '—'}`);
        const addrText = [...addr].filter(([v]) => !v.startsWith('#')).filter(([v, s]) => s.size && !(s.size === 1 && s.has('mem'))).map(([v, s]) => `${v}: ${[...s].sort().join(', ')}`);
        rows.push({ i, block: b.id, x, code: em, cost, regs: regText, addr: addrText });
      });
    }
    if (prog.ins.some((x) => isJump(x) && x.ti >= prog.ins.length)) code.push({ op: 'LABEL', L: 'EXIT' });
    return { code, rows, total, bb, lv, nRegs };
  }

  // ---------- peephole ----------
  // work on a linked form where jumps point at instruction objects, so deletions keep targets right
  function linked(ins) {
    const objs = ins.map((x) => ({ ...x }));
    objs.forEach((o, i) => { if (isJump(ins[i])) o.to = ins[i].ti < objs.length ? objs[ins[i].ti] : null; delete o.ti; });
    return objs;
  }
  function unlinked(objs) {
    const at = new Map(objs.map((o, i) => [o, i]));
    return objs.map((o) => { const y = { ...o }; if (isJump(o)) { y.ti = o.to === null ? objs.length : at.get(o.to); } delete y.to; return y; });
  }
  function labelNames(ins) {
    const targets = [...new Set(ins.filter(isJump).map((x) => x.ti))].sort((a, b) => a - b);
    const name = new Map(targets.map((t, k) => [t, t >= ins.length ? 'EXIT' : 'L' + (k + 1)]));
    return { name, T: (x) => name.get(x.ti) };
  }
  function peepholeTAC(ins0) {
    let objs = linked(ins0);
    const log = [];
    const del = (o) => {
      const i = objs.indexOf(o);
      const next = objs[i + 1] || null;
      for (const p of objs) if (p.to === o) p.to = next;
      objs.splice(i, 1);
    };
    const pos = (y) => (y === null ? 'EXIT' : `(${objs.indexOf(y) + 1})`);
    const show = (o) => `(${objs.indexOf(o) + 1}) ${insStr(o, (y) => pos(y.to))}`;
    let changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (const o of objs) {
        // constant folding and constant tests
        if (o.k === 'bin' && isNum(o.a) && isNum(o.b) && ARITH.concat(REL).includes(o.op)) {
          const v = String(arith(o.op, +o.a, +o.b)); log.push({ rule: 'Constant folding', text: `${show(o)} → ${o.dst} = ${v}` });
          Object.assign(o, { k: 'copy', a: v }); delete o.op; delete o.b; changed = true; break;
        }
        if (o.k === 'if' && isNum(o.a) && isNum(o.b)) {
          const t = arith(o.rel, +o.a, +o.b);
          log.push({ rule: 'Constant test', text: `${show(o)}: the test is always ${t ? 'true, so it becomes goto' : 'false, so it is deleted'}` });
          if (t) { o.k = 'goto'; delete o.a; delete o.b; delete o.rel; } else del(o);
          changed = true; break;
        }
        // algebraic identities and strength reduction
        if (o.k === 'bin') {
          const z = (v) => isNum(v) && +v === 0, one = (v) => isNum(v) && +v === 1, two = (v) => isNum(v) && +v === 2;
          let keep = null, text = null;
          if ((o.op === '+' && z(o.b)) || (o.op === '-' && z(o.b)) || ((o.op === '*' || o.op === '/') && one(o.b))) keep = o.a;
          else if ((o.op === '+' && z(o.a)) || (o.op === '*' && one(o.a))) keep = o.b;
          if (keep !== null) {
            if (keep === o.dst) { log.push({ rule: 'Algebraic identity', text: `${show(o)} does nothing, deleted` }); del(o); }
            else { log.push({ rule: 'Algebraic identity', text: `${show(o)} → ${o.dst} = ${keep}` }); Object.assign(o, { k: 'copy', a: keep }); delete o.op; delete o.b; }
            changed = true; break;
          }
          if (o.op === '*' && (z(o.a) || z(o.b))) { log.push({ rule: 'Algebraic identity', text: `${show(o)} → ${o.dst} = 0` }); Object.assign(o, { k: 'copy', a: '0' }); delete o.op; delete o.b; changed = true; break; }
          if (o.op === '*' && (two(o.b) || two(o.a))) {
            const y = two(o.b) ? o.a : o.b;
            log.push({ rule: 'Strength reduction', text: `${show(o)} → ${o.dst} = ${y} + ${y} (an add is cheaper than a multiply)` });
            o.op = '+'; o.a = y; o.b = y; changed = true; break;
          }
        }
        if (o.k === 'copy' && o.a === o.dst) { log.push({ rule: 'Algebraic identity', text: `${show(o)} does nothing, deleted` }); del(o); changed = true; break; }
        // jumps to jumps
        if (isJump(o) && o.to && o.to.k === 'goto' && o.to !== o && o.to.to !== o.to) {
          log.push({ rule: 'Jump to a jump', text: `${show(o)}: ${pos(o.to)} is itself goto ${pos(o.to.to)}, so jump there directly` });
          o.to = o.to.to; changed = true; break;
        }
        const i = objs.indexOf(o);
        // a jump to the very next instruction
        if (isJump(o) && o.to === (objs[i + 1] || null)) { log.push({ rule: 'Jump to the next instruction', text: `${show(o)} is deleted, control falls through to it anyway` }); del(o); changed = true; break; }
        // jump over a jump: if c goto L1; goto L2; L1: …  →  if not c goto L2
        if (o.k === 'if' && objs[i + 1] && objs[i + 1].k === 'goto' && o.to === (objs[i + 2] || null) && !objs.some((p) => p.to === objs[i + 1])) {
          const g = objs[i + 1];
          log.push({ rule: 'Jump over a jump', text: `${show(o)}; ${show(g)} → if ${condStr({ ...o, rel: NOT_REL[o.rel] })} goto ${pos(g.to)}` });
          o.rel = NOT_REL[o.rel]; o.to = g.to;
          objs.splice(i + 1, 1);
          changed = true; break;
        }
      }
      if (changed) continue;
      // unreachable code
      const reach = new Set();
      const st = objs.length ? [objs[0]] : [];
      while (st.length) {
        const o = st.pop();
        if (!o || reach.has(o)) continue;
        reach.add(o);
        const i = objs.indexOf(o);
        if (isJump(o) && o.to) st.push(o.to);
        if (o.k !== 'goto' && objs[i + 1]) st.push(objs[i + 1]);
      }
      const dead = objs.filter((o) => !reach.has(o));
      if (dead.length) {
        log.push({ rule: 'Unreachable code', text: `${dead.map(show).join('; ')}: no path from the start reaches ${dead.length > 1 ? 'them' : 'it'}, deleted` });
        dead.forEach(del); changed = true;
      }
    }
    return { ins: unlinked(objs), log };
  }
  // naive code: every statement loads its operands and stores its result
  function naiveCode(ins) {
    const { name } = labelNames(ins);
    const code = [];
    const ld = (d, v) => ({ op: 'LD', d, src: isNum(v) ? { kind: 'imm', v } : { kind: 'mem', name: v } });
    ins.forEach((x, i) => {
      if (name.has(i)) code.push({ op: 'LABEL', L: name.get(i) });
      const T = name.get(x.ti);
      switch (x.k) {
        case 'bin': code.push(ld(0, x.a), ld(1, x.b), { op: OPN[x.op], d: 0, s: 0, t: 1 }, { op: 'ST', dst: { kind: 'mem', name: x.dst }, s: 0 }); break;
        case 'un': code.push(ld(0, x.a)); if (x.op === 'minus') code.push({ op: 'NEG', d: 0, s: 0 }); else code.push(ld(1, '0'), { op: 'EQ', d: 0, s: 0, t: 1 }); code.push({ op: 'ST', dst: { kind: 'mem', name: x.dst }, s: 0 }); break;
        case 'copy': code.push(ld(0, x.a), { op: 'ST', dst: { kind: 'mem', name: x.dst }, s: 0 }); break;
        case 'load': code.push(ld(1, x.idx), { op: 'LD', d: 0, src: { kind: 'idx', arr: x.arr, r: 1 } }, { op: 'ST', dst: { kind: 'mem', name: x.dst }, s: 0 }); break;
        case 'store': code.push(ld(1, x.idx), ld(0, x.a), { op: 'ST', dst: { kind: 'idx', arr: x.arr, r: 1 }, s: 0 }); break;
        case 'goto': code.push({ op: 'BR', L: T }); break;
        case 'if': code.push(ld(0, x.a)); if (x.b !== '0') code.push(ld(1, x.b), { op: 'SUB', d: 0, s: 0, t: 1 }); code.push({ op: BR[x.rel], s: 0, L: T }); break;
      }
    });
    if (name.has(ins.length)) code.push({ op: 'LABEL', L: 'EXIT' });
    return code;
  }
  function peepholeMachine(code0) {
    let code = code0.map((m) => ({ ...m }));
    const log = [];
    // machine idiom: LD Ra, x; LD Rb, #1; ADD Ra, Ra, Rb; ST x, Ra  →  INC x
    for (let i = 0; i + 3 < code.length; i++) {
      const [a, b, c, d] = code.slice(i, i + 4);
      if (a.op === 'LD' && a.src.kind === 'mem' && b.op === 'LD' && b.src.kind === 'imm' && +b.src.v === 1 && c.op === 'ADD' && c.d === a.d && ((c.s === a.d && c.t === b.d) || (c.t === a.d && c.s === b.d)) && d.op === 'ST' && d.dst.kind === 'mem' && d.dst.name === a.src.name && d.s === a.d) {
        log.push({ rule: 'Machine idiom', text: `${[a, b, c, d].map(mStr).join('; ')} → INC ${a.src.name}` });
        code.splice(i, 4, { op: 'INC', name: a.src.name });
      }
    }
    // redundant loads and stores: remember what each register holds, reset at labels and jumps
    const out = [];
    let holds = new Map();
    const forget = (name) => { for (const [r, v] of holds) if (v === name) holds.delete(r); };
    for (const m of code) {
      if (m.op === 'LABEL') { holds = new Map(); out.push(m); continue; }
      if (m.op === 'LD') {
        const v = m.src.kind === 'mem' ? m.src.name : m.src.kind === 'imm' ? '#' + m.src.v : null;
        if (v && holds.get(m.d) === v) { log.push({ rule: 'Redundant load', text: `${mStr(m)}: R${m.d} already holds ${v}` }); continue; }
        holds.delete(m.d);
        if (v) holds.set(m.d, v);
        out.push(m); continue;
      }
      if (m.op === 'ST') {
        if (m.dst.kind === 'mem') {
          if (holds.get(m.s) === m.dst.name) { log.push({ rule: 'Redundant store', text: `${mStr(m)}: ${m.dst.name} already equals R${m.s}` }); continue; }
          forget(m.dst.name); holds.set(m.s, m.dst.name);
        }
        out.push(m); continue;
      }
      if (m.op === 'INC') { forget(m.name); out.push(m); continue; }
      if (m.op === 'BR' || m.L) { out.push(m); if (m.op === 'BR') holds = new Map(); continue; }
      if ('d' in m) holds.delete(m.d);
      out.push(m);
    }
    code = out;
    // BR to the next label, and code after BR that no label reaches
    for (let i = 0; i < code.length; i++) {
      const m = code[i];
      if (m.op === 'BR') {
        let j = i + 1;
        while (j < code.length && code[j].op === 'LABEL' && code[j].L !== m.L) j++;
        if ((j < code.length && code[j].op === 'LABEL' && code[j].L === m.L) || (j === code.length && m.L === 'EXIT' && !code.some((c) => c.op === 'LABEL' && c.L === 'EXIT'))) {
          log.push({ rule: 'Jump to the next instruction', text: `${mStr(m)} is deleted` }); code.splice(i, 1); i--; continue;
        }
        let k = i + 1;
        const gone = [];
        while (k < code.length && code[k].op !== 'LABEL') gone.push(code.splice(k, 1)[0]);
        if (gone.length) log.push({ rule: 'Unreachable code', text: `${gone.map(mStr).join('; ')} after ${mStr(m)}` });
      }
    }
    return { code, log };
  }
  function peephole(prog) {
    const tac = peepholeTAC(prog.ins);
    const before = naiveCode(prog.ins);
    const after = peepholeMachine(naiveCode(tac.ins));
    const cost = (c) => c.reduce((s, m) => s + mCost(m), 0);
    return { tac, before, after, costBefore: cost(before), costAfter: cost(after.code) };
  }

  DT.codegen = {
    tokenize, parseProgram, observedOf, insStr, defOf, usesOf, isJump, isNum, isTempName, subscript,
    run, equivalent, basicBlocks, blockTarget, dominators, liveness, nextUse, exitLiveOf,
    blockDAG, rebuildBlock, optimize, representations, toSSA, runSSA, checkSSA,
    generate, mStr, mCost, runMachine, checkMachine, naiveCode, peepholeTAC, peepholeMachine, peephole, labelNames
  };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
