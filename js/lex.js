/* Lexical analysis (Aho ch. 3) and Lex/Yacc: transition diagrams for relop, id
   and number, token patterns combined into one NFA and DFA, a lexer for C-like
   code with a symbol table, the two-buffer input scheme with sentinels, and
   .l / .y specifications run on real input. */
(function (DT) {
  'use strict';
  const isLetter = (c) => /^[A-Za-z_]$/.test(c);
  const isDigit = (c) => /^[0-9]$/.test(c);
  const isDelim = (c) => c === ' ' || c === '\t' || c === '\n';
  const EOF = '';

  // ---------- transition diagrams (Aho figs 3.13, 3.14, 3.16, 3.17) ----------
  // an edge matches one character, a class (letter, digit, delim) or "other"
  const e = (from, to, on) => ({ from, to, on });
  const DIAGRAMS = {
    relop: {
      title: 'relop', start: 0,
      states: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      accept: { 2: ['relop', 'LE'], 3: ['relop', 'NE'], 4: ['relop', 'LT', true], 5: ['relop', 'EQ'], 7: ['relop', 'GE'], 8: ['relop', 'GT', true] },
      edges: [e(0, 1, '<'), e(1, 2, '='), e(1, 3, '>'), e(1, 4, 'other'), e(0, 5, '='), e(0, 6, '>'), e(6, 7, '='), e(6, 8, 'other')]
    },
    id: {
      title: 'id (and keywords)', start: 9,
      states: [9, 10, 11],
      accept: { 11: ['id', 'installID()', true] },
      edges: [e(9, 10, 'letter'), e(10, 10, 'letter'), e(10, 10, 'digit'), e(10, 11, 'other')]
    },
    number: {
      title: 'unsigned number', start: 12,
      states: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
      accept: { 19: ['number', 'installNum()', true], 20: ['number', 'installNum()', true], 21: ['number', 'installNum()', true] },
      edges: [e(12, 13, 'digit'), e(13, 13, 'digit'), e(13, 14, '.'), e(13, 16, 'E'), e(13, 20, 'other'), e(14, 15, 'digit'), e(15, 15, 'digit'),
        e(15, 16, 'E'), e(15, 21, 'other'), e(16, 17, '+'), e(16, 17, '-'), e(16, 18, 'digit'), e(17, 18, 'digit'), e(18, 18, 'digit'), e(18, 19, 'other')]
    },
    ws: {
      title: 'white space', start: 22,
      states: [22, 23, 24],
      accept: { 24: ['ws', '(no token)', true] },
      edges: [e(22, 23, 'delim'), e(23, 23, 'delim'), e(23, 24, 'other')]
    }
  };
  // keyed lookups go through Maps so no property is read by a computed name
  const DIAGRAM_BY_KEY = new Map(Object.entries(DIAGRAMS));
  const ACCEPT = new Map(Object.values(DIAGRAMS).map((d) => [d, new Map(Object.entries(d.accept).map(([q, a]) => [Number(q), a]))]));
  const fits = (on, c) => (on === 'letter' ? isLetter(c) : on === 'digit' ? isDigit(c) : on === 'delim' ? isDelim(c) : on === c);
  function stepDiagram(d, s, c) {
    const out = d.edges.filter((x) => x.from === s);
    return out.find((x) => x.on !== 'other' && c !== EOF && fits(x.on, c)) || out.find((x) => x.on === 'other') || null;
  }
  // run one diagram from the start of the input; returns the path and the token, or where it failed
  function runDiagram(key, input) {
    const d = DIAGRAM_BY_KEY.get(key);
    if (!d) throw new Error(`Unknown transition diagram: ${key}`);
    const acc = ACCEPT.get(d);
    const path = [];
    let s = d.start, i = 0;
    for (;;) {
      if (acc.has(s)) break;
      const c = i < input.length ? input.charAt(i) : EOF;
      const edge = stepDiagram(d, s, c);
      if (!edge) return { d, path, fail: { state: s, c, at: i } };
      path.push({ from: s, to: edge.to, c, on: edge.on });
      s = edge.to; i++;
    }
    const [token, attr, retract] = acc.get(s);
    const end = retract ? i - 1 : i;
    return { d, path, state: s, token, attr, retract: !!retract, lexeme: input.slice(0, end), rest: input.slice(end) };
  }

  // ---------- token patterns → one NFA → DFA (Aho 3.8) ----------
  // each pattern becomes its minimal DFA (dead state removed); a new start state 0 has λ-moves to all of them
  function patternAutomaton(re) {
    const FA = DT.fa;
    const min = FA.minimize(FA.thompson(DT.regex.parse(re)).fa).min;
    const dead = FA.deadStates(min);
    const keep = [...Array(min.n).keys()].filter((q) => !dead.has(q));
    const idx = new Map(keep.map((q, i) => [q, i]));
    return {
      n: keep.length, start: idx.get(min.start),
      finals: new Set([...min.finals].filter((q) => idx.has(q)).map((q) => idx.get(q))),
      trans: min.trans.filter((t) => idx.has(t.from) && idx.has(t.to)).map((t) => ({ from: idx.get(t.from), sym: t.sym, to: idx.get(t.to) }))
    };
  }
  function parsePatterns(text) {
    const pats = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).map((l, i) => {
      const m = l.match(/^(\S+)\s+(.+)$/);
      if (!m) throw new Error(`Line "${l}": write a token name, then its regular expression.`);
      return { name: m[1], re: m[2].trim(), order: i };
    });
    if (!pats.length) throw new Error('Write at least one pattern.');
    return pats;
  }
  function combine(pats) {
    const EPS = DT.EPS;
    let n = 1;
    const trans = [], finals = new Set(), owner = new Map(), pieces = [];
    for (const p of pats) {
      let a;
      try { a = patternAutomaton(p.re); } catch (err) { throw new Error(`Pattern ${p.name}: ${err.message}`); }
      const off = n;
      trans.push({ from: 0, sym: EPS, to: off + a.start });
      a.trans.forEach((t) => trans.push({ from: off + t.from, sym: t.sym, to: off + t.to }));
      a.finals.forEach((q) => { finals.add(off + q); owner.set(off + q, p.order); });
      pieces.push({ ...p, first: off, last: off + a.n - 1, finals: [...a.finals].map((q) => off + q) });
      n += a.n;
    }
    const nfa = { n, start: 0, finals, trans, labels: [...Array(n).keys()].map(String) };
    const sub = DT.fa.subset(nfa);
    // a DFA state announces the first-listed pattern among the NFA final states it contains
    const announce = sub.sets.map((S) => {
      const hits = S.filter((q) => owner.has(q)).map((q) => owner.get(q));
      return hits.length ? Math.min(...hits) : null;
    });
    const labels = sub.sets.map((S) => (S.length ? S.join('') : '∅'));
    const names = sub.sets.map((S) => (S.length ? `{${S.join(',')}}` : '∅'));
    return { pats, pieces, nfa, dfa: { ...sub.fa, labels }, sets: sub.sets, names, announce, alphabet: sub.alphabet, owner };
  }
  // longest match with the combined DFA: run until no move, then back up to the last accepting state
  function scanDFA(comb, input) {
    const { dfa, announce } = comb;
    const next = new Map(dfa.trans.map((t) => [`${t.from},${t.sym}`, t.to]));
    const deadId = comb.sets.findIndex((S) => !S.length);
    const tokens = [];
    let pos = 0;
    while (pos < input.length) {
      let s = dfa.start, i = pos, last = null;
      const trace = [dfa.labels.at(s)];
      while (i < input.length) {
        const t = next.get(`${s},${input.charAt(i)}`);
        if (t === undefined || t === deadId) break;
        s = t; i++; trace.push(input.charAt(i - 1), dfa.labels.at(s));
        const pat = announce.at(s);
        if (pat !== null) last = { end: i, pat };
      }
      if (!last) return { tokens, error: { at: pos, c: input.charAt(pos) } };
      tokens.push({ lexeme: input.slice(pos, last.end), pat: last.pat, start: pos, trace, backedUp: i - last.end });
      pos = last.end;
    }
    return { tokens };
  }
  // the same job without the combined DFA: try each pattern's own automaton for the longest prefix
  function scanBrute(pats, input) {
    const auts = pats.map((p) => patternAutomaton(p.re));
    const accepts = (a, w) => {
      let S = new Set([a.start]);
      for (const c of w) { const T = new Set(); a.trans.forEach((t) => { if (S.has(t.from) && t.sym === c) T.add(t.to); }); S = T; if (!S.size) return false; }
      return [...S].some((q) => a.finals.has(q));
    };
    const tokens = [];
    let pos = 0;
    while (pos < input.length) {
      let best = null;
      for (let end = input.length; end > pos && !best; end--) {
        const k = auts.findIndex((a) => accepts(a, input.slice(pos, end)));
        if (k >= 0) best = { end, pat: k };
      }
      if (!best) return { tokens, error: { at: pos } };
      tokens.push({ lexeme: input.slice(pos, best.end), pat: best.pat });
      pos = best.end;
    }
    return { tokens };
  }

  // ---------- a lexer for C-like code ----------
  const KEYWORDS = new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'then']);
  const RELOPS = new Map([['<', 'LT'], ['<=', 'LE'], ['==', 'EQ'], ['!=', 'NE'], ['>', 'GT'], ['>=', 'GE']]);
  const OPERATORS = ['<<=', '>>=', '...', '->', '++', '--', '&&', '||', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
    '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', ':', '.'];
  const SEPARATORS = new Set(['(', ')', '{', '}', '[', ']', ';', ',']);
  function scanQuoted(code, i, q) {
    let j = i + 1;
    while (j < code.length && code.charAt(j) !== q && code.charAt(j) !== '\n') j += code.charAt(j) === '\\' ? 2 : 1;
    return j < code.length && code.charAt(j) === q ? j + 1 : -1;
  }
  function skipAt(code, i) {
    const ws = (k) => isDelim(code.charAt(k)) || code.charAt(k) === '\r';
    if (ws(i)) { let j = i; while (j < code.length && ws(j)) j++; return { end: j, kind: 'white space' }; }
    if (code.startsWith('//', i)) { const j = code.indexOf('\n', i); return { end: j < 0 ? code.length : j, kind: 'comment' }; }
    if (code.startsWith('/*', i)) { const j = code.indexOf('*/', i + 2); if (j < 0) return { end: code.length, kind: 'comment', error: 'comment is never closed' }; return { end: j + 2, kind: 'comment' }; }
    if (code.charAt(i) === '#' && (i === 0 || code.charAt(i - 1) === '\n')) { const j = code.indexOf('\n', i); return { end: j < 0 ? code.length : j, kind: 'preprocessor line' }; }
    return null;
  }
  function tokenAt(code, i, symIndex) {
    const c = code.charAt(i);
    if (isLetter(c)) {
      const r = runDiagram('id', code.slice(i));
      const lex = r.lexeme;
      if (KEYWORDS.has(lex)) return { lexeme: lex, token: lex, cat: 'keyword', attr: '' };
      return { lexeme: lex, token: 'id', cat: 'identifier', attr: symIndex(lex) };
    }
    if (isDigit(c)) {
      const r = runDiagram('number', code.slice(i));
      // "3." or "1E" stop the diagram half way: the digits read so far are the number
      const lexeme = r.fail ? code.slice(i).match(/^\d+/)[0] : r.lexeme;
      return { lexeme, token: 'number', cat: 'constant', attr: lexeme };
    }
    if (c === '"' || c === "'") {
      const j = scanQuoted(code, i, c);
      if (j < 0) return { lexeme: code.slice(i, code.indexOf('\n', i) < 0 ? code.length : code.indexOf('\n', i)), token: 'error', cat: 'error', attr: `unterminated ${c === '"' ? 'string' : 'character'} literal` };
      return { lexeme: code.slice(i, j), token: c === '"' ? 'literal' : 'char', cat: c === '"' ? 'string literal' : 'constant', attr: '' };
    }
    const op = OPERATORS.find((o) => code.startsWith(o, i));
    if (op && RELOPS.has(op)) return { lexeme: op, token: 'relop', cat: 'operator', attr: RELOPS.get(op) };
    if (op) return { lexeme: op, token: op, cat: 'operator', attr: '' };
    if (SEPARATORS.has(c)) return { lexeme: c, token: c, cat: 'separator', attr: '' };
    return { lexeme: c, token: 'error', cat: 'error', attr: 'no token starts with this character' };
  }
  function lexC(code) {
    const tokens = [], skipped = [], symtab = [];
    const symIndex = (name) => {
      let k = symtab.findIndex((s) => s.name === name);
      if (k < 0) { symtab.push({ name, line: line, uses: 0 }); k = symtab.length - 1; }
      symtab.at(k).uses++;
      return k + 1;
    };
    let i = 0, line = 1, col = 1;
    const advance = (to) => { for (; i < to; i++) { if (code.charAt(i) === '\n') { line++; col = 1; } else col++; } };
    while (i < code.length) {
      const sk = skipAt(code, i);
      if (sk) { skipped.push({ start: i, end: sk.end, kind: sk.kind, error: sk.error }); advance(sk.end); continue; }
      const t = tokenAt(code, i, symIndex);
      tokens.push({ ...t, start: i, end: i + t.lexeme.length, line, col });
      advance(i + Math.max(1, t.lexeme.length));
    }
    return { tokens, skipped, symtab };
  }
  // every character is in exactly one token or skipped piece, in order
  function covers(code, r) {
    const parts = [...r.tokens, ...r.skipped].sort((a, b) => a.start - b.start);
    let at = 0;
    for (const p of parts) { if (p.start !== at) return false; at = p.end; }
    return at === code.length;
  }

  // ---------- input buffering with two halves and sentinels (Aho 3.2) ----------
  function buffering(code, N) {
    const lx = lexC(code);
    const spans = [...lx.tokens.map((t) => ({ ...t, kind: 'token' })), ...lx.skipped.map((s) => ({ ...s, lexeme: code.slice(s.start, s.end), kind: s.kind }))].sort((a, b) => a.start - b.start);
    const block = (i) => Math.floor(i / N);
    const loadedAt = [];
    const frames = spans.map((sp) => {
      // forward has read up to sp.end (the character after the lexeme is looked at, then retracted)
      const lastRead = Math.min(sp.end, code.length);
      const top = block(lastRead);
      for (let b = loadedAt.length; b <= top; b++) loadedAt.push(b);
      const halves = [top % 2 === 0 ? top : top - 1, top % 2 === 1 ? top : top - 1].map((b) => (b < 0 ? null : b));
      const cells = halves.map((b) => {
        if (b === null) return null;
        const chunk = code.slice(b * N, b * N + N).split('');
        const realEnd = b * N + N >= code.length;
        return { block: b, chars: chunk, sentinel: realEnd ? 'eof (end of input)' : 'eof (sentinel)' };
      });
      const lost = block(sp.start) < top - 1;
      return { ...sp, top, cells, lexemeBegin: sp.start, forward: sp.end, lost, fromBuffer: lost ? null : readBack(code, cells, sp, N) };
    });
    const loads = block(Math.max(0, code.length)) + 1;
    return { N, frames, loads, testsWith: code.length + loads, testsWithout: 2 * code.length, tooLong: frames.filter((f) => f.lost && f.kind === 'token') };
  }
  function readBack(code, cells, sp, N) {
    let out = '';
    for (let i = sp.start; i < sp.end; i++) {
      const b = Math.floor(i / N), half = cells.find((c) => c && c.block === b);
      if (!half) return null;
      out += half.chars[i - b * N];
    }
    return out;
  }

  // ---------- Lex (.l) ----------
  function splitSections(text) {
    const parts = text.split(/^%%[ \t]*$/m);
    if (parts.length < 2) throw new Error('A Lex or Yacc file needs a %% line between the declarations and the rules.');
    return { decl: parts[0], rules: parts[1], code: parts.slice(2).join('%%') };
  }
  const stripCodeBlocks = (s) => s.replace(/^%\{[\s\S]*?^%\}/gm, '');
  // read a Lex pattern up to the first whitespace outside quotes and brackets
  function readPattern(line) {
    let i = 0, q = false, br = false;
    for (; i < line.length; i++) {
      const c = line.charAt(i);
      if (c === '\\') { i++; continue; }
      if (c === '"' && !br) q = !q;
      else if (!q && c === '[') br = true;
      else if (!q && c === ']') br = false;
      else if (!q && !br && (c === ' ' || c === '\t')) break;
    }
    return { pattern: line.slice(0, i), rest: line.slice(i).trim() };
  }
  // Lex syntax → JavaScript regular expression source
  function lexToJS(p, defs, depth = 0) {
    if (depth > 10) throw new Error('Definitions refer to each other in a loop.');
    let out = '', i = 0;
    while (i < p.length) {
      const c = p.charAt(i);
      if (c === '"') { const j = p.indexOf('"', i + 1); if (j < 0) throw new Error(`Unclosed quote in ${p}`); out += p.slice(i + 1, j).replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'); i = j + 1; continue; }
      if (c === '\\') { out += p.slice(i, i + 2); i += 2; continue; }
      if (c === '[') { const j = p.indexOf(']', i + 2); if (j < 0) throw new Error(`Unclosed [ in ${p}`); out += p.slice(i, j + 1); i = j + 1; continue; }
      if (c === '{') {
        const j = p.indexOf('}', i);
        const name = p.slice(i + 1, j);
        if (j > 0 && /^[A-Za-z_]\w*$/.test(name)) {
          if (!defs.has(name)) throw new Error(`{${name}} is not defined in the declarations section.`);
          out += `(?:${lexToJS(defs.get(name), defs, depth + 1)})`; i = j + 1; continue;
        }
      }
      if (c === '.') { out += '[^\\n]'; i++; continue; }
      if (c === '/') throw new Error('Trailing context (/) is not supported.');
      out += c; i++;
    }
    return out;
  }
  function readRules(body) {
    const rules = [];
    const lines = body.split('\n');
    for (let k = 0; k < lines.length; k++) {
      const raw = lines.at(k);
      if (!raw.trim() || /^\s/.test(raw)) continue;
      let { pattern, rest } = readPattern(raw);
      // an action in braces may continue over several lines
      if (rest.startsWith('{')) {
        let depth = (rest.match(/\{/g) || []).length - (rest.match(/\}/g) || []).length;
        while (depth > 0 && k + 1 < lines.length) { k++; const more = lines.at(k); rest += '\n' + more; depth += (more.match(/\{/g) || []).length - (more.match(/\}/g) || []).length; }
      }
      rules.push({ pattern, action: rest || ';', line: k + 1 });
    }
    return rules;
  }
  const MAX_RULE_SOURCE = 2000;
  function parseLex(text) {
    const s = splitSections(text);
    const defs = new Map();
    for (const raw of stripCodeBlocks(s.decl).split('\n')) {
      if (!raw.trim() || /^\s/.test(raw) || raw.startsWith('%')) continue;
      const m = raw.match(/^([A-Za-z_]\w*)\s+(\S.*)$/);
      if (m) defs.set(m[1], m[2].trim());
    }
    const rules = readRules(stripCodeBlocks(s.rules)).map((r, i) => {
      let src, re;
      // compiling the user's own Lex rule is the point of this tool; it runs only in their browser,
      // and the source length is capped so a pasted spec cannot build an unbounded pattern
      try {
        src = lexToJS(r.pattern, defs);
        if (src.length > MAX_RULE_SOURCE) throw new Error(`pattern is longer than ${MAX_RULE_SOURCE} characters`);
        // eslint-disable-next-line security/detect-non-literal-regexp, security-node/non-literal-reg-expr
        re = new RegExp(src, 'y'); // nosemgrep
      } catch (err) { throw new Error(`Rule ${i + 1} (${r.pattern}): ${err.message}`); }
      return { ...r, src, re, returns: returnsOf(r.action) };
    });
    if (!rules.length) throw new Error('The rules section has no patterns.');
    return { defs, rules, code: s.code.trim() };
  }
  function returnsOf(action) {
    const m = action.match(/return\s*\(?\s*(yytext\s*\[\s*0\s*\]|[A-Za-z_]\w*|'[^']+')/);
    return m ? m[1].replace(/\s/g, '') : null;
  }
  // yylex: longest match; on a tie the rule listed first wins; no match echoes one character
  function runLex(spec, input) {
    const out = [];
    let pos = 0;
    while (pos < input.length) {
      let best = null;
      spec.rules.forEach((r, k) => {
        r.re.lastIndex = pos;
        const m = r.re.exec(input);
        if (m && m[0].length && (!best || m[0].length > best.len)) best = { k, len: m[0].length };
      });
      if (!best) { out.push({ lexeme: input.charAt(pos), rule: null, start: pos }); pos++; continue; }
      const r = spec.rules[best.k];
      const lexeme = input.slice(pos, pos + best.len);
      let token = r.returns;
      if (/^yytext\[0\]$/.test(token || '')) token = `'${lexeme[0]}'`;
      out.push({ lexeme, rule: best.k, start: pos, token });
      pos += best.len;
    }
    return out;
  }

  // ---------- Yacc (.y) → grammar for the parsing engine ----------
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function stripActions(s) {
    let out = '', depth = 0;
    for (const c of s) {
      if (c === '{') depth++;
      if (!depth) out += c;
      if (c === '}') depth--;
    }
    return out;
  }
  function parseYacc(text) {
    const s = splitSections(text);
    const tokens = new Set(), prec = [], warnings = [];
    let start = null;
    for (const raw of stripCodeBlocks(s.decl).split('\n')) {
      const l = raw.trim();
      // %token NUM, %left '+' '-', %start expr  (an optional <type> tag is dropped)
      const words = l.replace(/<\w+>/g, ' ').split(/\s+/).filter(Boolean);
      const kw = words.shift() || '';
      if (kw === '%token') words.forEach((t) => tokens.add(t));
      else if (['%left', '%right', '%nonassoc'].includes(kw)) { prec.push({ assoc: kw.slice(1), toks: words }); words.forEach((t) => { if (!t.startsWith("'")) tokens.add(t); }); }
      else if (kw === '%start' && words.length) start = words[0];
    }
    const body = stripActions(stripCodeBlocks(s.rules)).replace(/\/\*[\s\S]*?\*\//g, '');
    const prods = [];
    for (const chunk of body.split(';')) {
      const m = chunk.match(/^\s*([A-Za-z_][\w.]*)\s*:([\s\S]*)$/);
      if (!m) { if (chunk.trim()) throw new Error(`Cannot read the rule "${chunk.trim().slice(0, 40)}". Write  lhs : alternative | alternative ;`); continue; }
      for (const alt of m[2].split('|')) {
        let syms = alt.trim().split(/\s+/).filter(Boolean);
        if (syms.includes('%prec')) { warnings.push(`%prec in ${m[1]} : ${alt.trim()} is ignored; the last terminal's precedence is used.`); syms = syms.slice(0, syms.indexOf('%prec')); }
        prods.push({ lhs: m[1], rhs: syms });
      }
    }
    if (!prods.length) throw new Error('The rules section has no grammar rules.');
    return toEngine({ prods, tokens, prec, start: start || prods[0].lhs, warnings });
  }
  // nonterminals get a capital letter, named tokens become lower case, 'c' becomes c
  function toEngine(y) {
    const nts = new Set(y.prods.map((p) => p.lhs));
    const map = new Map();
    const name = (sym) => {
      if (map.has(sym)) return map.get(sym);
      let v;
      if (nts.has(sym)) v = cap(sym.replace(/\./g, '_'));
      else if (/^'.+'$/.test(sym)) v = sym.slice(1, -1).replace(/^\\/, '');
      else v = sym.toLowerCase();
      map.set(sym, v);
      return v;
    };
    const order = [y.start, ...[...nts].filter((n) => n !== y.start)];
    const lines = order.map((A) => `${name(A)} -> ${y.prods.filter((p) => p.lhs === A).map((p) => p.rhs.map(name).join(' ') || 'ε').join(' | ')}`);
    const precText = y.prec.map((l) => `%${l.assoc} ${l.toks.map(name).join(' ')}`).join('\n');
    const undeclared = [...new Set(y.prods.flatMap((p) => p.rhs))].filter((t) => !nts.has(t) && !/^'/.test(t) && !y.tokens.has(t));
    if (undeclared.length) y.warnings.push(`Not declared with %token: ${undeclared.join(', ')}.`);
    return { ...y, map, grammarText: lines.join('\n'), precText, name };
  }
  // build the LALR(1) table the way yacc does, conflicts resolved by precedence
  function yaccTable(y) {
    const P = DT.parsing;
    const G = P.parseGrammar(y.grammarText);
    const GA = P.augment(G), ff = P.firstFollow(GA);
    const la = P.lalrFromLr1(GA, P.lr1Collection(GA, ff));
    const raw = P.lrTable(GA, la, 'lalr');
    const table = P.resolveConflicts(GA, raw, P.parsePrecedence(y.precText));
    return { G, GA, coll: la, raw, table };
  }
  // tokens from yylex, in the names the grammar uses
  function lexToYacc(y, lexOut) {
    const toks = [];
    for (const t of lexOut) {
      if (t.rule === null) return { error: `"${t.lexeme}" matched no Lex rule.` };
      if (!t.token) continue;
      toks.push(y.name(t.token));
    }
    return { toks };
  }

  DT.lex = {
    DIAGRAMS, runDiagram, parsePatterns, combine, scanDFA, scanBrute, patternAutomaton,
    lexC, covers, buffering, KEYWORDS, parseLex, runLex, lexToJS, parseYacc, yaccTable, lexToYacc
  };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
