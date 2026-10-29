/* Regular expression parsing, printing and simplifying algebra */
(function (DT) {
  'use strict';
  const EPS = 'λ';
  const EPS_CHARS = 'λεΛ∈@';

  function tokenize(src) {
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (/\s/.test(c)) continue;
      if (c === '+' || c === '|' || c === '∪') out.push({ k: 'or', i });
      else if (c === '*') out.push({ k: 'star', i });
      else if (c === '(') out.push({ k: '(', i });
      else if (c === ')') out.push({ k: ')', i });
      else if (c === '.' || c === '·') out.push({ k: 'dot', i });
      else if (EPS_CHARS.includes(c)) out.push({ k: 'eps', i });
      else if (c === '∅' || c === 'Ø' || c === 'φ' || c === 'ϕ') out.push({ k: 'empty', i });
      else if (/[a-zA-Z0-9]/.test(c)) out.push({ k: 'sym', v: c, i });
      else throw new Error(`"${String.fromCodePoint(src.codePointAt(i))}" is not allowed (position ${[...src.slice(0, i)].length + 1}). Use letters/digits, + * ( ) and λ.`);
    }
    return out;
  }

  /* Binary AST: {t:'sym',v} {t:'eps'} {t:'empty'} {t:'or',a,b} {t:'cat',a,b} {t:'star',a} */
  function parse(src) {
    const t = tokenize(src);
    if (!t.length) throw new Error('Expression is empty.');
    let p = 0;
    const peek = () => t[p];
    const where = () => (t[p] ? `position ${t[p].i + 1}` : 'the end');
    function union() {
      let a = concat();
      while (peek() && peek().k === 'or') { p++; a = { t: 'or', a, b: concat() }; }
      return a;
    }
    function concat() {
      let a = null;
      for (;;) {
        const k = peek() && peek().k;
        if (k === 'dot') { p++; continue; }
        if (k === 'sym' || k === 'eps' || k === 'empty' || k === '(') {
          const b = star();
          a = a ? { t: 'cat', a, b } : b;
        } else break;
      }
      if (!a) throw new Error(`Missing operand at ${where()}.`);
      return a;
    }
    function star() {
      let a = atom();
      while (peek() && peek().k === 'star') { p++; if (a.t !== 'star') a = { t: 'star', a }; }
      return a;
    }
    function atom() {
      const x = t[p++];
      if (x.k === 'sym') return { t: 'sym', v: x.v };
      if (x.k === 'eps') return { t: 'eps' };
      if (x.k === 'empty') return { t: 'empty' };
      const e = union();
      if (!peek() || peek().k !== ')') throw new Error(`")" missing at ${where()}.`);
      p++;
      return e;
    }
    const r = union();
    if (p < t.length) {
      const x = t[p];
      throw new Error(x.k === ')' ? `Extra ")" at position ${x.i + 1}.` : `Unexpected symbol at position ${x.i + 1}.`);
    }
    return r;
  }

  function astStr(e, ctx = 0) {
    let s, p;
    switch (e.t) {
      case 'sym': s = e.v; p = 4; break;
      case 'eps': s = EPS; p = 4; break;
      case 'empty': s = '∅'; p = 4; break;
      case 'star': s = astStr(e.a, 3) + '*'; p = 3; break;
      case 'cat': s = astStr(e.a, 2) + astStr(e.b, 2); p = 2; break;
      default: s = astStr(e.a, 1) + '+' + astStr(e.b, 1); p = 1;
    }
    return p < ctx ? '(' + s + ')' : s;
  }

  /* n-ary simplifying algebra used by state elimination. null means ∅. */
  const R = {
    eps: { t: 'eps' },
    sym: (v) => ({ t: 'sym', v }),
    str(r, ctx = 0) {
      if (!r) return '∅';
      let s, p;
      switch (r.t) {
        case 'sym': s = r.v; p = 4; break;
        case 'eps': s = EPS; p = 4; break;
        case 'star': s = R.str(r.a, 3) + '*'; p = 3; break;
        case 'cat': s = r.items.map((x) => R.str(x, 2)).join(''); p = 2; break;
        default: s = r.items.map((x) => R.str(x, 1)).join('+'); p = 1;
      }
      return p < ctx ? '(' + s + ')' : s;
    },
    or(a, b) {
      if (!a) return b;
      if (!b) return a;
      const raw = [...(a.t === 'or' ? a.items : [a]), ...(b.t === 'or' ? b.items : [b])];
      const seen = new Set();
      let items = [];
      for (const x of raw) { const k = R.str(x); if (!seen.has(k)) { seen.add(k); items.push(x); } }
      // if the union already contains λ, then  x x* = x x* + λ = x*
      const nullable = items.some((x) => x.t === 'eps' || x.t === 'star');
      if (nullable) {
        items = items.map((x) => {
          if (x.t !== 'cat' || x.items.length < 2) return x;
          const last = x.items[x.items.length - 1], first = x.items[0];
          const restL = R.str(x.items.length === 2 ? x.items[0] : { t: 'cat', items: x.items.slice(0, -1) });
          const restF = R.str(x.items.length === 2 ? x.items[1] : { t: 'cat', items: x.items.slice(1) });
          if (last.t === 'star' && R.str(last.a) === restL) return last;
          if (first.t === 'star' && R.str(first.a) === restF) return first;
          return x;
        });
        const seen2 = new Set();
        items = items.filter((x) => { const k = R.str(x); if (seen2.has(k)) return false; seen2.add(k); return true; });
      }
      const stars = items.filter((x) => x.t === 'star');
      if (stars.length) {
        const inner = new Set(stars.map((s) => R.str(s.a)));
        // λ + x* = x*   and   x + x* = x*
        items = items.filter((x) => !(x.t === 'eps') && !(x.t !== 'star' && inner.has(R.str(x))));
      }
      return items.length === 1 ? items[0] : { t: 'or', items };
    },
    cat(a, b) {
      if (!a || !b) return null;
      const raw = [...(a.t === 'cat' ? a.items : [a]), ...(b.t === 'cat' ? b.items : [b])].filter((x) => x.t !== 'eps');
      const items = [];
      for (const x of raw) {
        const prev = items[items.length - 1];
        if (prev && prev.t === 'star' && x.t === 'star' && R.str(prev) === R.str(x)) continue; // x*x* = x*
        items.push(x);
      }
      if (!items.length) return R.eps;
      return items.length === 1 ? items[0] : { t: 'cat', items };
    },
    star(a) {
      if (!a || a.t === 'eps') return R.eps;
      if (a.t === 'star') return a;
      if (a.t === 'or') {
        // (λ + x)* = x*   and   (x* + y)* = (x + y)*
        let u = null;
        for (const x of a.items) { if (x.t === 'eps') continue; u = R.or(u, x.t === 'star' ? x.a : x); }
        if (!u) return R.eps;
        a = u;
        if (a.t === 'star') return a;
      }
      return { t: 'star', a };
    },
    fromAst(e) {
      switch (e.t) {
        case 'sym': return R.sym(e.v);
        case 'eps': return R.eps;
        case 'empty': return null;
        case 'star': return R.star(R.fromAst(e.a));
        case 'cat': return R.cat(R.fromAst(e.a), R.fromAst(e.b));
        default: return R.or(R.fromAst(e.a), R.fromAst(e.b));
      }
    }
  };

  DT.EPS = EPS;
  DT.isEps = (s) => s === '' || EPS_CHARS.includes(s) || s === 'eps' || s === 'lambda';
  DT.regex = { tokenize, parse, astStr, R };
})(typeof window !== 'undefined' ? (window.DT = window.DT || {}) : (globalThis.DT = globalThis.DT || {}));
