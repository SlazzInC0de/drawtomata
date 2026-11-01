/* Shared core: the one definition of the empty-string spellings and of how grammar text is read.
   Every converter goes through these, so a fix here applies everywhere. Load this file first. */
(function (DT) {
  'use strict';
  const EPS = 'λ';
  // single characters accepted as the empty string (inside a regex or a grammar body)
  const EPS_CHARS = 'λεΛ∈@';
  // whole words accepted as the empty string
  const EPS_WORDS = new Set([...EPS_CHARS, 'eps', 'epsilon', 'lambda']);
  const isEps = (s) => s === '' || EPS_WORDS.has(s);

  // the arrows people write between the two sides of a production
  const ARROW = /^(.*?)(->|→|=>|::=|⟶|—>|-->)(.*)$/;

  // Splits grammar text into productions. Lines (or ';'-separated parts) look like "A -> α | β";
  // a line starting with '|' continues the previous one. Comments start with // or #.
  // Returns [{ line, lhs, rhs }] where lhs is null for a continuation line.
  // The caller checks the left side and splits rhs into alternatives in its own notation.
  function readProductions(text, { example = 'S -> aSb | λ', form = 'A -> aB | b' } = {}) {
    const lines = String(text).split(/\n|;/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('#'));
    if (!lines.length) throw new Error(`Grammar is empty. Write productions like  ${example}`);
    const out = [];
    for (const line of lines) {
      const m = line.match(ARROW);
      if (m) out.push({ line, lhs: m[1].trim(), rhs: m[3] });
      else if (line.startsWith('|') && out.length) out.push({ line, lhs: null, rhs: line.slice(1) });
      else throw new Error(`Cannot read "${line}". Use the form  ${form}`);
    }
    return out;
  }

  // nonterminals that derive the empty string (any grammar with { prods: [{ lhs, rhs: [] }] })
  function nullableSet(G) {
    const N = new Set();
    for (let ch = true; ch;) { ch = false; for (const p of G.prods) if (!N.has(p.lhs) && p.rhs.every((s) => N.has(s))) { N.add(p.lhs); ch = true; } }
    return N;
  }

  // Arithmetic expressions, shared by code generation and the compiler phases:
  //   rel  → add (relop add)?        (only when opts.rel)
  //   add  → mul (('+' | '-') mul)*
  //   mul  → unary (('*' | '/' | '%') unary)*   ('%' only when opts.mod)
  //   unary → ('-' | 'minus') unary | ('!' | 'not') unary | primary
  //   primary → '(' rel ')' | number | id | id '[' rel ']' (index only when opts.index)
  // Tokens can be anything: opts.text(tok) gives its text and opts.kind(tok) gives 'id', 'num' or 'op'.
  // opts.node builds the tree nodes and opts.error words the messages, so each caller keeps its own
  // node shapes and wording while the grammar and precedence live here once.
  const RELOPS = ['<', '<=', '>', '>=', '==', '!='];
  function parseExpr(toks, opts, pos = 0) {
    const { text, kind, node, error } = opts;
    let p = pos;
    const peekText = () => (p < toks.length ? text(toks[p]) : undefined);
    const isOp = (...ops) => p < toks.length && kind(toks[p]) === 'op' && ops.includes(text(toks[p]));
    const word = (w) => opts.words && p < toks.length && String(text(toks[p])).toLowerCase() === w;
    const close = (c) => { if (!isOp(c)) error.expect(c, toks[p]); p++; };
    function primary() {
      if (p >= toks.length) return error.end();
      const t = toks[p];
      if (isOp('(')) { p++; const e = rel(); close(')'); return e; }
      if (kind(t) === 'num') { p++; return node.num(t); }
      if (kind(t) === 'id') {
        p++;
        if (opts.index && isOp('[')) { p++; const i = rel(); close(']'); return node.index(t, i); }
        return node.id(t);
      }
      return error.unexpected(t);
    }
    function unary() {
      if (isOp('-') || word('minus')) { p++; return node.neg(unary()); }
      if (opts.not && (isOp('!') || word('not'))) { p++; return node.not(unary()); }
      return primary();
    }
    const MUL = opts.mod ? ['*', '/', '%'] : ['*', '/'];
    function mul() { let l = unary(); while (isOp(...MUL)) { const op = peekText(); p++; l = node.bin(op, l, unary()); } return l; }
    function add() { let l = mul(); while (isOp('+', '-')) { const op = peekText(); p++; l = node.bin(op, l, mul()); } return l; }
    function rel() { const l = add(); if (opts.rel && isOp(...RELOPS)) { const op = peekText(); p++; return node.bin(op, l, add()); } return l; }
    return { e: rel(), pos: p };
  }

  DT.EPS = EPS;
  DT.isEps = isEps;
  DT.core = { EPS, EPS_CHARS, EPS_WORDS, isEps, ARROW, readProductions, nullableSet, RELOPS, parseExpr };
})(typeof window !== 'undefined' ? (window.DT = window.DT || {}) : (globalThis.DT = globalThis.DT || {}));
