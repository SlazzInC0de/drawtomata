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

  DT.EPS = EPS;
  DT.isEps = isEps;
  DT.core = { EPS, EPS_CHARS, EPS_WORDS, isEps, ARROW, readProductions, nullableSet };
})(typeof window !== 'undefined' ? (window.DT = window.DT || {}) : (globalThis.DT = globalThis.DT || {}));
