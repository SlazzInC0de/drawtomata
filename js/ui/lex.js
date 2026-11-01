/* Lexer tool, including the phases of a compiler. */
(function (DT) {
  'use strict';
  const App = DT.app;
  const { ui, esc, $, $$, store, showErr, rerenders, showTab, stage, chip, blank, emptyState } = App;
  // LEXICAL ANALYSIS
  const LX = DT.lex;
  let lastLx = 'td';
  const show = (c) => (c === ' ' ? '␣' : c === '\n' ? '↵' : c === '\t' ? '⇥' : c === '' ? 'eof' : c);
  function syncLx() {
    $$('#tab-lex [data-show]').forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(lastLx); });
    $$('[data-lx]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lx === lastLx)));
  }
  function diagramGraph(d, path) {
    const used = new Set((path || []).map((p) => `${p.from}>${p.to}`));
    const nodes = d.states.map((q) => {
      const acc = d.accept[q];
      return { id: q, label: acc && acc[2] ? `${q}*` : String(q), start: q === d.start, final: !!acc };
    });
    const m = new Map();
    for (const x of d.edges) { const k = `${x.from}>${x.to}`; if (!m.has(k)) m.set(k, { from: x.from, to: x.to, label: [], cls: used.has(k) ? 'dep' : '' }); m.get(k).label.push(x.on); }
    return { nodes, edges: [...m.values()].map((x) => ({ ...x, label: x.label.join(', ') })) };
  }
  function lxDiagrams() {
    const key = $('#lxDiag').value;
    const input = $('#lxLexeme').value;
    const r = LX.runDiagram(key, input);
    const steps = r.path.map((p, i) => [String(i + 1), String(p.from), esc(show(p.c)), esc(p.on), String(p.to)]);
    const verdict = r.fail
      ? App.badChip(`stuck in state ${r.fail.state} on “${show(r.fail.c)}”: not a ${r.d.title}`)
      : App.okChip(`${r.token === 'ws' ? 'white space' : `token ${r.token}`}, lexeme “${r.lexeme}”${r.retract ? ', forward retracts one character (*)' : ''}`);
    let html = stage('lx-td', '', `Transition diagram: ${esc(r.d.title)}`, verdict,
      `<p>Start in the state marked by the arrow and follow the edge for each character; <b>other</b> means any character with no edge of its own, including the end of the input. A state marked * has read one character too far, so forward moves back one place before the token is returned.</p>
       <div class="cols"><div>${ui.slot(diagramGraph(r.d, r.path))}</div>
       <div><div class="sub">Accepting states</div>${App.grid(['State', 'Action'], Object.entries(r.d.accept).map(([q, acc]) => [`${q}${acc[2] ? '*' : ''}`, { v: esc(`return(${acc[0]}, ${acc[1]})`), cls: 'l' }]))}
       <div class="sub">Moves on “${esc(input)}”</div>${steps.length ? App.grid(['#', 'From', 'Read', 'Edge', 'To'], steps) : '<p class="muted">No moves.</p>'}
       ${r.fail ? '' : `<p>lexemeBegin = 0, forward ends at ${r.lexeme.length}: the lexeme is <b class="mono">${esc(r.lexeme)}</b>${r.rest ? `, and scanning continues at “${esc(r.rest)}”` : ''}.</p>`}
       ${key === 'id' ? `<p class="small muted">Keywords are found by the same diagram: installID() puts reserved words such as ${[...LX.KEYWORDS].slice(0, 5).join(', ')} into the symbol table first, and getToken() returns their own token.</p>` : ''}</div></div>`);
    return html;
  }
  function lxPatterns() {
    const pats = LX.parsePatterns($('#lxPats').value);
    const c = LX.combine(pats);
    const input = $('#lxPatIn').value;
    const chunks = input.split(/\s+/).filter(Boolean);
    const scan = chunks.map((w) => ({ w, a: LX.scanDFA(c, w), b: LX.scanBrute(pats, w) }));
    const same = scan.every((x) => !x.a.error && !x.b.error && x.a.tokens.map((t) => t.lexeme + t.pat).join() === x.b.tokens.map((t) => t.lexeme + t.pat).join());
    const nfaG = { nodes: [...Array(c.nfa.n).keys()].map((q) => ({ id: q, label: String(q), start: q === 0, final: c.nfa.finals.has(q), xlabel: c.owner.has(q) ? pats[c.owner.get(q)].name : '' })), edges: mergeLabelled(c.nfa.trans) };
    const dead = c.sets.findIndex((S) => !S.length);
    const dfaG = { nodes: c.sets.map((S, i) => ({ id: i, label: c.dfa.labels[i], start: i === 0, final: c.announce[i] !== null, xlabel: c.announce[i] !== null ? pats[c.announce[i]].name : '' })).filter((n) => n.id !== dead), edges: mergeLabelled(c.dfa.trans.filter((t) => t.to !== dead)) };
    const rows = c.sets.map((S, i) => [esc(c.names[i]), ...c.alphabet.map((a) => esc(c.names[c.dfa.trans.find((t) => t.from === i && t.sym === a).to])), c.announce[i] === null ? '—' : `<b>${esc(pats[c.announce[i]].name)}</b>`]);
    const tokRows = scan.flatMap((x) => (x.a.error ? [[esc(x.w), { v: `no pattern matches at “${esc(x.w.slice(x.a.error.at))}”`, cls: 'no' }, '', '']] : x.a.tokens.map((t) => [esc(t.lexeme), esc(pats[t.pat].name), esc(t.trace.join(' ')), t.backedUp ? `read ${t.backedUp} more, then backed up` : ''])));
    return stage('lx-nfa', '1', 'One NFA for all the patterns', chip('NFA states', c.nfa.n),
      `<p>Each pattern becomes a small automaton (its minimal DFA). A new start state 0 has a λ-move to the start of each one; every final state remembers its pattern.</p>${ui.slot(nfaG)}`)
      + stage('lx-dfa', '2', 'Subset construction', chip('DFA states', c.dfa.n),
        `<p>A DFA state is a set of NFA states. When it holds final states of several patterns, it announces the one listed first: that is how a keyword beats an identifier of the same length.</p>
         ${App.grid(['DFA state', ...c.alphabet.map(esc), 'Announces'], rows)}${ui.slot(dfaG)}`)
      + stage('lx-scan', '3', `Scanning “${esc(input)}”`, same ? App.okChip('same tokens as trying every pattern for the longest match') : App.badChip('differs from a pattern-by-pattern check'),
        `<p>Longest match: run the DFA until no move is possible, then back up to the last state that announced a pattern. That prefix is the lexeme; scanning starts again right after it.</p>
         ${App.grid(['Lexeme', 'Pattern', 'States visited', ''], tokRows)}`);
  }
  function mergeLabelled(trans) {
    const m = new Map();
    for (const t of trans) { const k = `${t.from}>${t.to}`; if (!m.has(k)) m.set(k, { from: t.from, to: t.to, syms: [] }); m.get(k).syms.push(t.sym); }
    return [...m.values()].map((x) => ({ from: x.from, to: x.to, label: x.syms.join(',') }));
  }
  function lxPlay() {
    const code = $('#lxCode').value;
    const r = LX.lexC(code);
    const counts = {};
    r.tokens.forEach((t) => { counts[t.cat] = (counts[t.cat] || 0) + 1; });
    const rows = r.tokens.map((t, i) => [String(i + 1), { v: esc(t.lexeme), cls: t.token === 'error' ? 'no' : '' }, esc(t.token), esc(String(t.attr)), esc(t.cat), `${t.line}:${t.col}`]);
    const stream = r.tokens.map((t) => `&lt;${esc(t.token)}${t.attr !== '' && t.token !== 'error' ? ', ' + esc(String(t.attr)) : ''}&gt;`).join(' ');
    const skippedText = r.skipped.filter((s) => s.kind !== 'white space').map((s) => `${s.kind}${s.error ? ` (${s.error})` : ''}: ${esc(code.slice(s.start, s.end).slice(0, 40))}`);
    const errors = r.tokens.filter((t) => t.token === 'error');
    return stage('lx-play', '', 'Token stream', chip('tokens', r.tokens.length) + (LX.covers(code, r) ? App.okChip('every character is in one token or skipped') : App.badChip('characters lost')) + (errors.length ? App.badChip(`${errors.length} lexical error${errors.length > 1 ? 's' : ''}`) : ''),
      `<p>Identifiers and numbers are read with the id and number transition diagrams; reserved words are looked up after an identifier is read. Relational operators carry their attribute (LT, LE, …) as in Aho, and an identifier carries a pointer to its symbol-table entry.</p>
       <div class="prods" style="white-space:normal">${stream}</div>
       <div class="summary" style="margin-top:12px">${Object.entries(counts).map(([k, v]) => chip(esc(k), v)).join('')}</div>
       ${App.grid(['#', 'Lexeme', 'Token', 'Attribute', 'Class', 'Line:col'], rows)}
       ${skippedText.length ? `<div class="sub">Skipped, not tokens</div><ul class="steps" style="font-family:inherit;font-size:14px">${skippedText.map((x) => `<li class="mono">${x}</li>`).join('')}</ul>` : ''}`)
      + stage('lx-sym', '', 'Symbol table', chip('entries', r.symtab.length),
        `<p>One entry per distinct identifier, made the first time the lexer meets it. Later occurrences get the same pointer.</p>
         ${App.grid(['Entry', 'Name', 'First seen (line)', 'Occurrences'], r.symtab.map((s, i) => [String(i + 1), esc(s.name), String(s.line), String(s.uses)]))}`);
  }
  function bufferRow(f) {
    const cell = (half, k) => {
      const abs = half.block * f.N + k;
      const cls = [abs >= f.lexemeBegin && abs < f.forward ? 'lexeme' : '', abs === f.lexemeBegin ? 'lb' : '', abs === f.forward ? 'fw' : ''].filter(Boolean).join(' ');
      return `<span class="bc ${cls}">${esc(show(half.chars[k]))}</span>`;
    };
    const halves = f.cells.map((h, i) => (h ? `<span class="bhalf">${h.chars.map((_, k) => cell(h, k)).join('')}<span class="bc eof ${h.block * f.N + h.chars.length === f.forward ? 'fw' : ''}" title="${esc(h.sentinel)}">eof</span></span>` : `<span class="bhalf empty">half ${i + 1} not loaded yet</span>`));
    return `<div class="buf">${halves.join('')}</div>`;
  }
  function lxBuffer() {
    const N = Math.max(2, Math.min(64, +$('#lxN').value || 8));
    const code = $('#lxCode').value;
    const b = LX.buffering(code, N);
    const ok = b.frames.every((f) => f.lost || f.fromBuffer === f.lexeme);
    const frames = b.frames.filter((f) => f.kind === 'token').slice(0, 40);
    const rows = frames.map((f) => `<div class="bframe"><div class="small"><b class="mono">${esc(f.lexeme)}</b> <span class="muted">${esc(f.token)} · lexemeBegin = ${f.lexemeBegin}, forward = ${f.forward}${f.lost ? '' : ''}</span>${f.lost ? ` ${App.badChip('the start of this lexeme was overwritten: it is longer than the buffer allows')}` : ''}</div>${bufferRow({ ...f, N })}</div>`).join('');
    return stage('lx-buf', '', 'Input buffering with sentinels', chip('N', N) + chip('buffer loads', b.loads) + (ok ? App.okChip('every lexeme read back from the buffers matches the input') : App.badChip('a lexeme read back wrongly')) + (b.tooLong.length ? App.badChip(`${b.tooLong.length} lexeme${b.tooLong.length > 1 ? 's' : ''} too long for N = ${N}`) : ''),
      `<p>Two halves of N characters each, each followed by a sentinel <b>eof</b>. lexemeBegin marks the start of the lexeme, forward scans ahead. When forward reaches the sentinel at the end of one half, the other half is reloaded with the next N characters; an eof that is not at the end of a half is the real end of the input.</p>
       <div class="formula" style="white-space:normal">Tests per character: without sentinels 2 (end of buffer? then which character?) = ${b.testsWithout}; with sentinels 1, plus one more at each of the ${b.loads} buffer ends ≈ ${b.testsWith}. A lexeme longer than N can be lost, because the half holding its start gets reloaded.</div>
       <p class="legend"><span class="bc lexeme lb">l</span> lexemeBegin &nbsp; <span class="bc fw">f</span> forward &nbsp; <span class="bc lexeme">x</span> current lexeme</p>
       ${rows}${b.frames.filter((f) => f.kind === 'token').length > 40 ? '<p class="small muted">The first 40 tokens are shown.</p>' : ''}`);
  }
  function lxLexYacc() {
    const spec = LX.parseLex($('#lxL').value);
    const input = $('#lxLyIn').value;
    const out = LX.runLex(spec, input);
    const defRows = [...spec.defs].map(([k, v]) => [esc(k), esc(v)]);
    const ruleRows = spec.rules.map((r, i) => [String(i + 1), { v: esc(r.pattern), cls: 'l' }, { v: esc(r.action.replace(/\s+/g, ' ')), cls: 'l' }, esc(r.returns || '—')]);
    const lexRows = out.filter((t) => t.rule === null || t.token || spec.rules[t.rule].action.trim() !== ';').map((t) => [esc(show(t.lexeme)), t.rule === null ? 'no rule: ECHO' : `rule ${t.rule + 1}`, esc(t.token || '—')]);
    let html = stage('lx-l', '1', 'Lex file', chip('rules', spec.rules.length),
      `<p>yylex() tries every pattern at the current position, takes the <b>longest</b> match, and on a tie the rule written <b>first</b>. Its action runs with the lexeme in yytext; <b>return</b> hands a token to the parser.</p>
       ${defRows.length ? `<div class="sub">Definitions</div>${App.grid(['Name', 'Pattern'], defRows)}` : ''}
       <div class="sub">Rules</div>${App.grid(['#', 'Pattern', 'Action', 'Returns'], ruleRows)}
       <div class="sub">yylex() on “${esc(input)}”</div>${App.grid(['Lexeme', 'Matched', 'Token'], lexRows)}
       <p class="small muted">White space matched by a rule whose action is just ; is skipped and not listed.</p>`);
    const ytext = $('#lxY').value.trim();
    if (!ytext) return html;
    const y = LX.parseYacc(ytext);
    const t = LX.yaccTable(y);
    const toks = LX.lexToYacc(y, out);
    const pr = toks.error ? null : DT.parsing.lrParse(t.GA, t.table, toks.toks);
    const conflictsBefore = t.raw.conflicts.length;
    const decisions = t.table.resolved.slice(0, 12).map((d) => `<li>I${d.s}, ${esc(d.a)}: ${esc(d.before)} → <b>${esc(d.after)}</b>. ${esc(d.reason)}</li>`).join('');
    const trace = pr ? App.traceTable(['Stack', 'Input', 'Action'], pr.rows.map((r) => [esc(r.stack), App.inputCell(r.input), esc(r.action)]), pr.accepted) : '';
    psLoad = { g: y.grammarText, prec: y.precText, w: toks.error ? '' : toks.toks.join(' ') };
    html += stage('lx-y', '2', 'Yacc file → LALR(1) table', chip('LALR states', t.coll.states.length) + (conflictsBefore ? chip('conflicts', `${conflictsBefore} → ${t.table.conflicts.length}`) : App.okChip('no conflicts')) + (pr ? (pr.accepted ? App.okChip('the tokens from yylex parse') : App.badChip('syntax error')) : ''),
      `<p>Yacc builds an LALR(1) table. Shift/reduce conflicts are settled by the %left / %right declarations, or by shifting; reduce/reduce conflicts by the rule listed first. A rule with <b>%prec</b> takes the precedence of the token named after it, which is how unary minus binds tighter than *.</p>
       ${y.overrides.length ? `<p class="small muted">%prec: ${y.overrides.map(([k, v]) => esc(`${k.replace('|', ' → ')} uses ${v}`)).join('; ')}. The Parsing tab has no %prec, so these rules fall back to their last terminal there.</p>` : ''}
       ${y.warnings.map((w) => `<p class="small muted">${esc(w)}</p>`).join('')}
       <div class="cols"><div><div class="sub">Grammar as the parser sees it</div>${App.gramBlock(t.G)}</div><div><div class="sub">Precedence</div><div class="prods">${esc(y.precText || 'none')}</div></div></div>
       ${decisions ? `<div class="sub">How the conflicts were settled</div><ul class="steps" style="font-family:inherit;font-size:14px">${decisions}</ul>${t.table.resolved.length > 12 ? `<p class="small muted">${t.table.resolved.length - 12} more settled the same way.</p>` : ''}` : ''}
       ${toks.error ? `<p><b>${esc(toks.error)}</b></p>` : `<div class="sub">yyparse() on the tokens ${esc(toks.toks.join(' '))}</div>${trace}`}
       <div class="btnRow"><button type="button" class="ghost" id="lxToParse">Open the grammar in the Parsing tab</button></div>`);
    return html;
  }
  let psLoad = null;
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#lxToParse') || !psLoad) return;
    $('#psIn').value = psLoad.g; $('#psPrec').value = psLoad.prec; $('#psUsePrec').checked = true; if (psLoad.w) $('#psW').value = psLoad.w;
    showTab('parse'); App.runPS('lalr');
  });
  // PHASES OF A COMPILER (lexer tab)
  function astGraph(tree) {
    const nodes = [], edges = [];
    const label = (n) => {
      switch (n.k) {
        case 'assign': return '=';
        case 'id': return `⟨id, ${n.entry}⟩`;
        case 'num': return n.text;
        case 'neg': return 'minus';
        case 'conv': return n.to === 'float' ? 'inttofloat' : 'floattoint';
        default: return n.op;
      }
    };
    const walk = (n) => {
      const id = nodes.length;
      nodes.push({ id, label: label(n), shape: n.k === 'id' || n.k === 'num' ? 'plaintext' : n.k === 'conv' ? 'box' : 'circle' });
      const kids = n.k === 'assign' ? [n.target, n.e] : n.k === 'bin' ? [n.l, n.r] : n.a ? [n.a] : [];
      kids.forEach((c) => edges.push({ from: id, to: walk(c), label: '' }));
      return id;
    };
    walk(tree);
    return { nodes, edges, rankdir: 'TB', ordering: true };
  }
  function lxPhases() {
    const PH = DT.phases;
    const r = PH.run($('#lxStmt').value);
    const stream = r.tokens.map((t) => `&lt;${esc(t.token === 'number' ? t.lexeme : t.token)}${t.token === 'id' ? `, ${t.attr}` : ''}&gt;`).join(' ');
    const listing = (code) => `<div class="prods">${code.map((x) => esc(PH.tacStr(x))).join('\n')}</div>`;
    const trees = (list) => list.map((t) => ui.slot(astGraph(t))).join('');
    const symRows = r.symtab.map((e, i) => [String(i + 1), esc(e.name), e.type]);
    const verdict = r.check.ok ? App.okChip('the optimized code and the machine code compute the same values as the three-address code on 30 random inputs') : App.badChip(`${r.check.phase} gives a different ${r.check.v}`);
    return stage('ph-0', '', 'The phases of a compiler', verdict,
      `<p>The statement goes through each phase in turn; the symbol table is shared by all of them. This is Aho, Lam, Sethi and Ullman, figure 1.7.</p>
       <div class="sub">Character stream</div><div class="prods">${esc(r.source)}</div>
       <div class="sub">Symbol table</div>${App.grid(['Entry', 'Name', 'Type'], symRows)}`)
      + stage('ph-1', '1', 'Lexical analyzer', chip('tokens', r.tokens.length),
        `<p>Groups characters into lexemes and emits a token for each. An identifier becomes ⟨id, n⟩, where n is its symbol-table entry; operators and numbers stand for themselves. White space is dropped.</p><div class="prods" style="white-space:normal">${stream}</div>`)
      + stage('ph-2', '2', 'Syntax analyzer', '',
        `<p>Builds the syntax tree from the tokens. Operators are interior nodes and their operands are children; * sits below + because it binds tighter.</p>${trees(r.trees)}`)
      + stage('ph-3', '3', 'Semantic analyzer', r.notes.length ? chip('conversions', r.notes.length) : App.okChip('types agree'),
        `<p>Checks types against the symbol table. Where an int meets a float, it inserts a conversion node, drawn as a box.</p>
         ${r.notes.length ? `<ul class="steps" style="font-family:inherit;font-size:14px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${trees(r.typed)}`)
      + stage('ph-4', '4', 'Intermediate code generator', chip('instructions', r.tac.length),
        `<p>Walks the tree and writes three-address code, one temporary for each operator.</p>${listing(r.tac)}`)
      + stage('ph-5', '5', 'Code optimizer', chip('instructions', `${r.tac.length} → ${r.opt.code.length}`),
        `<p>Does at compile time what it can: conversions and arithmetic on constants are folded, and a copy into the target is merged with the instruction that computes it.</p>
         ${r.opt.log.length ? `<ul class="steps" style="font-family:inherit;font-size:14px">${r.opt.log.map((n) => `<li class="mono">${esc(n)}</li>`).join('')}</ul>` : '<p class="small muted">Nothing to improve.</p>'}${listing(r.opt.code)}`)
      + stage('ph-6', '6', 'Code generator', chip('instructions', r.prog.length),
        `<p>Maps each instruction onto the target machine: LD loads a register, ST stores it, and the F suffix marks floating-point operations. # marks an immediate constant.</p>
         <div class="prods">${r.prog.map((m) => esc(m.text)).join('\n')}</div>`);
  }

  function runLx(op) {
    lastLx = op || lastLx;
    syncLx();
    showErr($('#lxErr'), '');
    const need = { ph: '#lxStmt', td: '#lxLexeme', re: '#lxPats', play: '#lxCode', buf: '#lxCode', ly: '#lxL' }[lastLx];
    if (need && blank(need)) {
      const what = { ph: ['Type a statement', 'An assignment such as position = initial + rate * 60 goes through all six phases of a compiler.'], td: ['Type some input', 'The chosen transition diagram reads it character by character, as a lexer would.'], re: ['Write token patterns', 'One per line: a token name, then its regular expression. They are combined into one NFA and DFA.'], play: ['Paste some code', 'C-like code is split into tokens with their attributes, and the symbol table is built.'], buf: ['Paste some code', 'Watch lexemeBegin and forward move through the two buffer halves.'], ly: ['Paste a Lex file', 'Add a Yacc file too to build its LALR(1) table and parse the tokens.'] }[lastLx];
      emptyState($('#lxOut'), what[0], what[1], 'lex');
      return;
    }
    let html;
    try {
      html = lastLx === 'ph' ? lxPhases() : lastLx === 're' ? lxPatterns() : lastLx === 'play' ? lxPlay() : lastLx === 'buf' ? lxBuffer() : lastLx === 'ly' ? lxLexYacc() : lxDiagrams();
    } catch (e) { showErr($('#lxErr'), e.message); return; }
    ['lxLexeme', 'lxPats', 'lxPatIn', 'lxCode', 'lxN', 'lxL', 'lxY', 'lxLyIn', 'lxStmt'].forEach((k) => store.set(k, $('#' + k).value));
    store.set('lxop', lastLx);
    ui.put($('#lxOut'), html);
  }
  rerenders.lex = () => runLx();
  $$('[data-lx]').forEach((b) => b.addEventListener('click', () => runLx(b.dataset.lx)));
  $('#lxGo').addEventListener('click', () => runLx());
  $('#lxDiag').addEventListener('change', () => {
    const sample = { relop: '<= x', id: 'count1+', number: '3.14E+5;', ws: '  x' };
    $('#lxLexeme').value = sample[$('#lxDiag').value]; runLx('td');
  });
  ['#lxLexeme', '#lxPatIn', '#lxLyIn', '#lxN'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') runLx(); }));

  App.export({ runLx: () => runLx });
})(window.DT);
