<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/drawtomata-logo-dark.svg">
    <img src="assets/drawtomata-logo.svg" alt="Drawtomata" width="300">
  </picture>
</p>

<p align="center">
  <a href="https://drawtomata.vercel.app/"><b>Open Drawtomata</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/SlazzInC0de/drawtomata/actions/workflows/test.yml"><img src="https://github.com/SlazzInC0de/drawtomata/actions/workflows/test.yml/badge.svg" alt="tests" align="center"></a>
</p>

Drawtomata converts between regular expressions, finite automata and grammars, and shows the working: closure tables, subset tables, the minimization table, state elimination steps, derivations. I built it because these conversions are easy to get wrong by hand in a TOC exam and hard to check.

![Draw FA screen](docs/screenshot.png)

**Contents:** [Features](#features) · [Input format](#input-format) · [Keyboard](#keyboard-draw-fa) · [Running it](#running-it) · [Layout](#layout) · [Roadmap](#roadmap) · [Security and privacy](#security-and-privacy) · [License](#license)

## Features

**RE → FA.** Thompson construction to a λ-NFA, λ-closure method to an NFA, subset construction to a DFA, then minimization with both the mark (table-filling) procedure and the π-partition method.

**Draw FA.** Draw any DFA, NFA or λ-NFA on a canvas and run:
- remove λ-moves, NFA → DFA, minimize
- FA → RE by state elimination (tries elimination orders and keeps the shortest result, or uses yours)
- FA → right-linear and left-linear grammar
- string tests

The canvas has pan and zoom, undo/redo, autosave, auto-layout, and PNG / SVG / JSON export.

**Language → DFA.** Starts with, ends with, contains, count or length mod m, count or length compared to k, k-th symbol from the right. Conditions can be negated and combined with AND / OR (product construction).

**Grammar ⇄ FA.** Right-linear and left-linear grammars to NFA.

**CFG & PDA.** Leftmost and rightmost derivations, parse trees, an ambiguity search, the strings of L(G) up to a length, CFG → NPDA (GNF method or the general method) and an NPDA simulator that prints the instantaneous descriptions.

**Parsing.** For any context-free grammar:
- FIRST and FOLLOW sets, with the passes that built them
- left recursion removal (direct and indirect) and left factoring
- LL(1) predictive parsing table with conflicts explained, the non-recursive parse trace, and recursive descent procedures with a call trace
- LR(0) items and automaton, SLR(1), canonical LR(1) and LALR(1) tables, with a shift-reduce trace for any input
- yacc-style `%left` / `%right` declarations to resolve conflicts, an operator precedence parser, and rewriting an ambiguous expression grammar into an unambiguous one

**Pumping lemma.** Play the adversary game for classic non-regular languages (aⁿbⁿ, wwᴿ, ww, aⁿbⁿcⁿ, square and prime lengths, balanced parentheses): every split xyz is listed with the i that breaks it. For a regular language given as an RE, the minimal DFA and the pigeonhole argument show the split that always pumps.

**More grammar tools.** NPDA → CFG with Linz's [qᵢ A qⱼ] construction (the NPDA is normalized first, and the grammar is checked against the simulator), and grammar simplification (λ-productions, unit productions, useless symbols) with conversion to Chomsky normal form.

**Phases of a compiler.** Type `position = initial + rate * 60` (or your own statements, with optional `int` / `float` declarations) to see the output of every phase, as in the Dragon Book's figure 1.7: tokens and symbol table, syntax tree, type checking with `inttofloat`, three-address code, optimized code and target machine code. The optimized and machine code are run against the three-address code on random inputs.

**Lexical analysis.** Paste C code to get the token stream with lexemes, token names and attributes (`<id, 1> <relop, LE> <number, 42>`), counts by class and the symbol table. Trace Aho's relop, id, number and white-space transition diagrams move by move, combine token patterns into one NFA and DFA that announces the winning pattern in each state (Aho fig. 3.54), and step through input buffering with two halves and sentinels. Lex and Yacc files run for real: yylex takes the longest match (trailing context `r/s` included), the `.y` grammar becomes an LALR(1) table with conflicts settled by `%left` / `%right` and `%prec`, and the tokens are parsed step by step. The DFA scanner is checked against trying every pattern on its own, and every lexeme is read back through the buffers.

**Syntax-directed translation.** Write a grammar with semantic rules (`E -> E1 + T { E.val = E1.val + T.val }`) and an input string to get the annotated parse tree, the dependency graph with a topological evaluation order, an S-attributed and L-attributed check that names the rule breaking it, and the syntax tree built by `Node` and `Leaf` calls. Inherited attributes, actions such as `addType`, and string translations with `||` all work. The values are checked by evaluating a second way: one postorder pass for S-attributed definitions, one depth-first left-to-right pass for L-attributed ones.

**Code generation.** Three-address code with quadruples, triples and indirect triples; DAGs by the value-number method; SSA form with φ-functions placed at dominance frontiers; leaders, basic blocks, flow graphs and natural loops; live variables and next-use tables; block optimization through the DAG (common subexpressions, constant folding, dead code); the getReg code generator with register and address descriptors and instruction costs; and a peephole optimizer on both three-address and target code. Every transformed program is run against the original on random inputs, and the target code on a small simulated machine.

Every result is checked against its input before it is shown. The ambiguity search is bounded, so "none found" is evidence, not a proof.

Notation follows Peter Linz, *An Introduction to Formal Languages and Automata*, for automata, and Aho, Lam, Sethi and Ullman, *Compilers*, for parsing and code generation.

## Input format

| What | Example |
| --- | --- |
| Regular expression | `(a+b)*abb` with `+` union, `*` star, `λ`/`ε`/`@` empty string, `∅` empty set |
| Grammar | `S -> aSb \| λ` one production per line; variables are capitals like `S` or `A1` |
| Parsing grammar | `E -> E + T \| T`, `F -> ( E ) \| id`; words like `id`, `if`, `num` are single terminals |
| Precedence | `%left + -` then `%left * /`, lowest precedence first |
| NPDA | `δ(q0, a, z) = {(q0, az), (q1, λ)}` with the stack top written first |
| Lex / Yacc | standard `.l` and `.y` files: definitions, `%%`, rules with actions, trailing context `r/s`; `%token`, `%left`, `%right`, `%nonassoc`, `%prec`, `%start` |
| SDD | `T' -> * F T1' { T1'.inh = T'.inh * F.val ; T'.syn = T1'.syn }`; write `E1`, `T1'` for a second copy of a nonterminal |
| Program | `x = a + b * c`, `a[i] = x`, `if i <= 10 goto (3)`, `L1: goto L2`; lines may be numbered `(3)` or `3)`; `t1`, `t2`, … are temporaries |

## Keyboard (Draw FA)

| Key | Action |
| --- | --- |
| `V` / `H` / `S` / `A` / `E` | select, pan, state, transition, erase |
| double-click | add a state, or rename one |
| `Delete` | delete the selection |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `F`, `+`, `-`, `0` | fit, zoom in, zoom out, 100% |
| `Space` + drag | pan |

## Running it

There is no build step. Open `index.html`, or serve the folder:

```
npm start        # python3 -m http.server 8000
npm test         # node tests/run.js
```

Diagrams use [viz.js](https://github.com/mdaines/viz-js) 3.2.4 (Graphviz in WebAssembly), served from `js/vendor` with its SRI hash pinned, so the site needs no CDN; a plain SVG layout is the fallback.

To deploy, push the folder to GitHub and enable Pages on the root of `main`, or import the repo into Vercel or Netlify with no build command.

## Layout

```
index.html
css/style.css
js/regex.js      RE parser and simplification rules
js/automata.js   Thompson, λ-removal, subset, minimization, state elimination, products
js/grammar.js    grammar parsing, CFG derivations, ambiguity, NPDA
js/parsing.js    FIRST/FOLLOW, LL(1), recursive descent, LR(0)/SLR/CLR/LALR, precedence
js/theory.js     pumping lemma, NPDA → CFG, simplification and CNF
js/phases.js     the phases of a compiler on one statement
js/lex.js        transition diagrams, patterns to DFA, C lexer, input buffering, Lex/Yacc
js/sdt.js        semantic rules, annotated parse trees, dependency graphs, S/L-attributed checks
js/codegen.js    three-address code, DAGs, SSA, blocks, liveness, code generator, peephole
scripts/build-pages.js  one page per converter (/nfa-to-dfa/, /ll1-parser/, …) and the sitemap, built from index.html
js/render.js     diagrams and tables
js/editor.js     the drawing canvas
js/app.js        page wiring
tests/run.js     conversion tests
```

## Roadmap

| Release | Adds |
| --- | --- |
| 21 Oct 2026 | Parsing: FIRST/FOLLOW, left recursion, left factoring, LL(1), recursive descent, LR(0), SLR, CLR, LALR, precedence |
| 23 Oct 2026 | Pumping lemma game, NPDA → CFG, grammar simplification and CNF |
| 25 Oct 2026 | Code generation: three-address code, quadruples and triples, DAGs, SSA, basic blocks and flow graphs, liveness, code generator, peephole |
| 27 Oct 2026 | Syntax-directed translation: annotated parse trees, dependency graphs and evaluation order, S/L-attributed checks, syntax trees |
| 29 Oct 2026 | Lexical analysis: transition diagrams, patterns to one DFA, lexer and symbol table, input buffering, Lex/Yacc files |

## Security and privacy

Drawtomata runs entirely in your browser. There are no accounts, no backend and no analytics, and your diagrams are autosaved only to this browser's `localStorage`. The site ships with a strict Content Security Policy and security headers (`vercel.json`).

Found a vulnerability? Please report it privately as described in [SECURITY.md](SECURITY.md).

## License

MIT
