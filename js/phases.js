/* The phases of a compiler on one statement (Aho 1.2, fig. 1.7): lexical analysis,
   syntax analysis, semantic analysis, intermediate code, code optimization and
   code generation, with the symbol table they share. */
(function (DT) {
  'use strict';
  const TYPES = new Set(['int', 'float']);
  const isFloatLit = (s) => /[.eE]/.test(s);
  const fmtFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

  // ---------- input: optional declarations, then assignments ----------
  function splitInput(text) {
    const decls = new Map(), stmts = [];
    for (const raw of text.split(/\n|;/)) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      const m = line.match(/^(int|float)\s+(.+)$/);
      if (m) { m[2].split(',').map((x) => x.trim()).filter(Boolean).forEach((v) => decls.set(v, m[1])); continue; }
      stmts.push(line);
    }
    if (!stmts.length) throw new Error('Write at least one assignment, such as position = initial + rate * 60.');
    return { decls, stmts };
  }

  // ---------- syntax analysis: assignment → id = expr ----------
  function parseTokens(toks) {
    let p = 0;
    const peek = () => toks[p];
    const is = (lex) => peek() && peek().lexeme === lex;
    const fail = (what) => { throw new Error(peek() ? `Syntax error at "${peek().lexeme}": expected ${what}.` : `Syntax error: the statement ends where ${what} was expected.`); };
    function factor() {
      const t = peek();
      if (!t) fail('an operand');
      if (t.lexeme === '(') { p++; const e = expr(); if (!is(')')) fail('")"'); p++; return e; }
      if (t.lexeme === '-') { p++; return { k: 'neg', a: factor() }; }
      if (t.token === 'id') { p++; return { k: 'id', name: t.lexeme, entry: t.attr }; }
      if (t.token === 'number') { p++; return { k: 'num', text: t.lexeme, float: isFloatLit(t.lexeme) }; }
      return fail('an operand');
    }
    function term() { let l = factor(); while (is('*') || is('/')) { const op = toks[p++].lexeme; l = { k: 'bin', op, l, r: factor() }; } return l; }
    function expr() { let l = term(); while (is('+') || is('-')) { const op = toks[p++].lexeme; l = { k: 'bin', op, l, r: term() }; } return l; }
    if (!peek() || peek().token !== 'id') fail('the name being assigned');
    const target = { k: 'id', name: peek().lexeme, entry: peek().attr };
    p++;
    if (!is('=')) fail('"="');
    p++;
    const e = expr();
    if (is(';')) p++;
    if (p < toks.length) fail('the end of the statement');
    return { k: 'assign', target, e };
  }

  // ---------- semantic analysis: types, and conversions where int meets float ----------
  function typeOf(n, decls, notes) {
    switch (n.k) {
      case 'id': n.type = decls.get(n.name) || 'float'; return n;
      case 'num': n.type = n.float ? 'float' : 'int'; return n;
      case 'neg': n.a = typeOf(n.a, decls, notes); n.type = n.a.type; return n;
      case 'bin': {
        n.l = typeOf(n.l, decls, notes); n.r = typeOf(n.r, decls, notes);
        if (n.l.type !== n.r.type) {
          const side = n.l.type === 'int' ? 'l' : 'r';
          notes.push(`${show(n[side])} is an int used with a float in ${n.op}, so inttofloat is inserted`);
          n[side] = { k: 'conv', to: 'float', a: n[side], type: 'float' };
        }
        n.type = n.l.type;
        return n;
      }
      default: return n;
    }
  }
  function checkAssign(st, decls, notes) {
    st.target.type = decls.get(st.target.name) || 'float';
    st.e = typeOf(st.e, decls, notes);
    if (st.e.type === 'int' && st.target.type === 'float') { notes.push(`${st.target.name} is a float, so the int value is converted with inttofloat`); st.e = { k: 'conv', to: 'float', a: st.e, type: 'float' }; }
    if (st.e.type === 'float' && st.target.type === 'int') { notes.push(`${st.target.name} is an int, so the float value is truncated with floattoint (a possible loss of precision)`); st.e = { k: 'conv', to: 'int', a: st.e, type: 'int' }; }
    return st;
  }
  const idName = (n) => `id${n.entry}`;
  function show(n) {
    switch (n.k) {
      case 'id': return idName(n);
      case 'num': return n.text;
      case 'neg': return `-${show(n.a)}`;
      case 'conv': return `${n.to === 'float' ? 'inttofloat' : 'floattoint'}(${show(n.a)})`;
      case 'bin': return `${show(n.l)} ${n.op} ${show(n.r)}`;
      default: return '';
    }
  }

  // ---------- intermediate code: three-address code, one temporary per operator ----------
  function genTAC(stmts) {
    const code = [];
    let t = 0;
    const walk = (n) => {
      if (n.k === 'id') return idName(n);
      if (n.k === 'num') return n.text;
      // operands first, so temporaries are numbered in evaluation order (t1 before t2)
      const a = walk(n.k === 'bin' ? n.l : n.a);
      const b = n.k === 'bin' ? walk(n.r) : undefined;
      const dst = `t${++t}`;
      if (n.k === 'bin') code.push({ dst, op: n.op, a, b, type: n.type });
      else if (n.k === 'neg') code.push({ dst, op: 'minus', a, type: n.type });
      else code.push({ dst, op: n.to === 'float' ? 'inttofloat' : 'floattoint', a, type: n.type });
      return dst;
    };
    for (const st of stmts) code.push({ dst: idName(st.target), op: 'copy', a: walk(st.e), type: st.target.type });
    return code;
  }
  const tacStr = (x) => {
    if (x.op === 'copy') return `${x.dst} = ${x.a}`;
    if (x.op === 'minus') return `${x.dst} = minus ${x.a}`;
    if (x.op === 'inttofloat' || x.op === 'floattoint') return `${x.dst} = ${x.op}(${x.a})`;
    return `${x.dst} = ${x.a} ${x.op} ${x.b}`;
  };

  // ---------- code optimization ----------
  const isLit = (v) => /^-?\d/.test(v);
  const isTemp = (v) => /^t\d+$/.test(v);
  function foldOnce(code, log) {
    for (let i = 0; i < code.length; i++) {
      const x = code[i];
      let v = null;
      if (x.op === 'inttofloat' && isLit(x.a)) v = fmtFloat(+x.a);
      else if (x.op === 'floattoint' && isLit(x.a)) v = String(Math.trunc(+x.a));
      else if (x.op === 'minus' && isLit(x.a)) v = String(-x.a);
      else if (['+', '-', '*', '/'].includes(x.op) && isLit(x.a) && isLit(x.b)) v = arithLit(x);
      if (v === null || !isTemp(x.dst)) continue;
      log.push(`${tacStr(x)} is computed now, at compile time: ${x.dst} is ${v}`);
      code.splice(i, 1);
      code.forEach((y) => { if (y.a === x.dst) y.a = v; if (y.b === x.dst) y.b = v; });
      return true;
    }
    return false;
  }
  function arithLit(x) {
    const a = +x.a, b = +x.b;
    const r = x.op === '+' ? a + b : x.op === '-' ? a - b : x.op === '*' ? a * b : b === 0 ? NaN : a / b;
    if (Number.isNaN(r)) return null;
    return x.type === 'float' ? fmtFloat(r) : String(Math.trunc(r));
  }
  // x = t, where t is a temporary used only here: compute straight into x
  function copyOnce(code, log) {
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (c.op !== 'copy' || !isTemp(c.a)) continue;
      const k = code.findIndex((y) => y.dst === c.a);
      const uses = code.filter((y) => y.a === c.a || y.b === c.a).length;
      if (k < 0 || k > i || uses !== 1) continue;
      log.push(`${tacStr(c)} only copies ${c.a}, so ${c.a} is computed straight into ${c.dst}`);
      code[k] = { ...code[k], dst: c.dst };
      code.splice(i, 1);
      return true;
    }
    return false;
  }
  function optimize(tac) {
    const code = tac.map((x) => ({ ...x }));
    const log = [];
    let guard = 0;
    while ((foldOnce(code, log) || copyOnce(code, log)) && guard++ < 200);
    renumber(code);
    return { code, log };
  }
  // t2, t3 … become t1, t2 … after instructions disappear
  function renumber(code) {
    const map = new Map();
    for (const x of code) if (isTemp(x.dst) && !map.has(x.dst)) map.set(x.dst, `t${map.size + 1}`);
    for (const x of code) { if (map.has(x.dst)) x.dst = map.get(x.dst); if (map.has(x.a)) x.a = map.get(x.a); if (map.has(x.b)) x.b = map.get(x.b); }
  }

  // ---------- code generation (Aho's simple machine, F for floating point) ----------
  const OPS = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV' };
  function genCode(code) {
    const out = [];
    const inReg = new Map();
    let next = 1;
    const free = [];
    const take = () => (free.length ? free.shift() : next++);
    const operand = (v) => (isLit(v) ? `#${v}` : inReg.has(v) ? `R${inReg.get(v)}` : null);
    const load = (v, f) => {
      if (inReg.has(v)) { const r = inReg.get(v); inReg.delete(v); return r; }
      const r = take();
      out.push({ op: `LD${f}`, args: [`R${r}`, isLit(v) ? `#${v}` : v], r, src: v });
      return r;
    };
    for (const x of code) {
      const f = x.type === 'float' ? 'F' : '';
      let r;
      if (x.op === 'copy') r = load(x.a, f);
      else if (x.op === 'minus') { r = load(x.a, f); out.push({ op: `NEG${f}`, args: [`R${r}`, `R${r}`] }); }
      else if (x.op === 'inttofloat' || x.op === 'floattoint') { r = load(x.a, x.op === 'inttofloat' ? '' : 'F'); out.push({ op: x.op === 'inttofloat' ? 'ITOF' : 'FTOI', args: [`R${r}`, `R${r}`] }); }
      else {
        r = load(x.a, f);
        let b = operand(x.b);
        if (b && inReg.has(x.b)) { free.push(inReg.get(x.b)); inReg.delete(x.b); }
        if (!b) { const rb = load(x.b, f); b = `R${rb}`; free.push(rb); }
        out.push({ op: `${OPS[x.op]}${f}`, args: [`R${r}`, `R${r}`, b] });
      }
      if (isTemp(x.dst)) inReg.set(x.dst, r);
      else { out.push({ op: `ST${f}`, args: [x.dst, `R${r}`] }); free.push(r); }
    }
    return out.map((m) => ({ ...m, text: `${m.op} ${m.args.join(', ')}` }));
  }

  // ---------- running the code, to check each phase against the previous one ----------
  function evalTAC(code, env0) {
    const env = new Map(env0);
    const val = (v) => (isLit(v) ? +v : env.get(v));
    for (const x of code) {
      let v;
      if (x.op === 'copy') v = val(x.a);
      else if (x.op === 'minus') v = -val(x.a);
      else if (x.op === 'inttofloat') v = val(x.a);
      else if (x.op === 'floattoint') v = Math.trunc(val(x.a));
      else { const a = val(x.a), b = val(x.b); v = x.op === '+' ? a + b : x.op === '-' ? a - b : x.op === '*' ? a * b : a / b; if (x.type === 'int') v = Math.trunc(v); }
      env.set(x.dst, v);
    }
    return env;
  }
  function runMachine(prog, env0) {
    const mem = new Map(env0), R = [];
    const val = (s) => (s.startsWith('#') ? +s.slice(1) : s.startsWith('R') ? R[+s.slice(1)] : mem.get(s));
    for (const m of prog) {
      const [d, a, b] = m.args;
      const base = m.op.replace(/F$/, '');
      if (base === 'LD') R[+d.slice(1)] = val(a);
      else if (base === 'ST') mem.set(d, val(a));
      else if (base === 'NEG') R[+d.slice(1)] = -val(a);
      else if (m.op === 'ITOF') R[+d.slice(1)] = val(a);
      else if (m.op === 'FTOI') R[+d.slice(1)] = Math.trunc(val(a));
      else {
        const x = val(a), y = val(b);
        let v = base === 'ADD' ? x + y : base === 'SUB' ? x - y : base === 'MUL' ? x * y : x / y;
        if (!m.op.endsWith('F')) v = Math.trunc(v);
        R[+d.slice(1)] = v;
      }
    }
    return mem;
  }
  function verify(symtab, decls, tac, opt, prog) {
    const assigned = [...new Set(tac.filter((x) => !isTemp(x.dst)).map((x) => x.dst))];
    for (let s = 1; s <= 30; s++) {
      const env = new Map(symtab.map((e, i) => {
        const v = ((s * 7919 + i * 104729) % 97) / 4 + 1;
        return [`id${i + 1}`, (decls.get(e.name) || 'float') === 'int' ? Math.round(v) : v];
      }));
      const a = evalTAC(tac, env), b = evalTAC(opt, env), c = runMachine(prog, env);
      for (const v of assigned) {
        if (Math.abs(a.get(v) - b.get(v)) > 1e-9) return { ok: false, phase: 'optimized code', v };
        if (Math.abs(a.get(v) - c.get(v)) > 1e-9) return { ok: false, phase: 'target code', v };
      }
    }
    return { ok: true };
  }

  function run(text) {
    const { decls, stmts } = splitInput(text);
    const source = stmts.join('\n');
    const lx = DT.lex.lexC(source);
    const bad = lx.tokens.find((t) => t.token === 'error');
    if (bad) throw new Error(`Lexical error at "${bad.lexeme}": ${bad.attr}.`);
    const lines = [];
    let cur = [];
    let line = 1;
    for (const t of lx.tokens) { if (t.line !== line) { if (cur.length) lines.push(cur); cur = []; line = t.line; } cur.push(t); }
    if (cur.length) lines.push(cur);
    const trees = lines.map(parseTokens);
    const plainTrees = JSON.parse(JSON.stringify(trees));
    const notes = [];
    const typed = trees.map((st) => checkAssign(st, decls, notes));
    const tac = genTAC(typed);
    const opt = optimize(tac);
    const prog = genCode(opt.code);
    const symtab = lx.symtab.map((e) => ({ ...e, type: decls.get(e.name) || 'float' }));
    const check = verify(symtab, decls, tac, opt.code, prog);
    return { decls, source, tokens: lx.tokens, symtab, trees: plainTrees, typed, notes, tac, opt, prog, check };
  }

  DT.phases = { run, tacStr, show, splitInput, parseTokens, genTAC, optimize, genCode, evalTAC, runMachine, TYPES };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
