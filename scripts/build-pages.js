// Builds one page per converter (e.g. /nfa-to-dfa/) from index.html, so each tool
// has its own URL, title and explanation that search engines can index.
// Run with: node scripts/build-pages.js   (tests/run.js checks the output is current)
const fs = require('fs');
const path = require('path');

const SITE = 'https://drawtomata.vercel.app';
const root = path.resolve(__dirname, '..');
const INDEX_FILE = path.resolve(__dirname, '..', 'index.html');
const SLUG = /^[a-z0-9-]+$/;

const PAGES = [
  {
    slug: 'nfa-to-dfa', tab: 'fa', op: 'dfa', example: 'endsab',
    title: 'NFA to DFA Converter, Step by Step (Subset Construction) | Drawtomata',
    description: 'Free NFA to DFA converter. Draw an NFA and get the subset construction table, the DFA diagram and its transition table, with every step shown.',
    h1: 'NFA to DFA converter',
    leadHtml: 'Draw or load an NFA above and press <b>NFA → DFA</b>. Drawtomata builds the DFA by subset construction and shows the full table of subsets, the resulting DFA and its transition table, then checks that both machines accept the same language.',
    bodyHtml: `
<h2>How the subset construction works</h2>
<p>Each state of the DFA stands for a <em>set</em> of NFA states: the states the NFA could be in after reading the same input.</p>
<ol>
<li>The start state of the DFA is {q0}, or the λ-closure of q0 if the NFA has λ-moves.</li>
<li>For a DFA state S and a symbol a, the next state is the set of NFA states reachable from any state in S on a (followed by λ-moves, if any).</li>
<li>Every new set becomes a new DFA state. Repeat until no new sets appear.</li>
<li>A DFA state is final if its set contains at least one final state of the NFA. The empty set ∅ is the trap state.</li>
</ol>
<h2>Example</h2>
<p>The NFA loaded above accepts strings over {a, b} that end in <b>ab</b>: q0 loops on a and b, q0 –a→ q1 and q1 –b→ q2, with q2 final.</p>
<table class="ex"><thead><tr><th>DFA state</th><th>a</th><th>b</th></tr></thead><tbody>
<tr><td>→ {q0}</td><td>{q0, q1}</td><td>{q0}</td></tr>
<tr><td>{q0, q1}</td><td>{q0, q1}</td><td>{q0, q2}</td></tr>
<tr><td>* {q0, q2}</td><td>{q0, q1}</td><td>{q0}</td></tr>
</tbody></table>
<p>Only three of the 2³ = 8 possible subsets are reachable, so the DFA has three states. The tool lists the subsets in the order they are discovered, which is how the table is written in an exam.</p>
<h2>Questions</h2>
<h3>Can the DFA have more states than the NFA?</h3>
<p>Yes. An NFA with n states can need up to 2ⁿ DFA states. The NFA for “the k-th symbol from the right is a” is the classic case where all 2ᵏ subsets are needed.</p>
<h3>What if my NFA has λ (ε) moves?</h3>
<p>Use the same button. The start state and every move are closed under λ-moves, and the λ-closure of each state is shown. To remove λ-moves first and keep an NFA, see <a href="../epsilon-nfa-to-nfa/">ε-NFA to NFA</a>.</p>
<h3>Is the result minimal?</h3>
<p>Not always. Run <a href="../dfa-minimization/">DFA minimization</a> on it next to merge equivalent states.</p>`
  },
  {
    slug: 'regex-to-dfa', tab: 're',
    title: 'Regex to DFA Converter: RE to NFA to DFA, Step by Step | Drawtomata',
    description: 'Convert a regular expression to an NFA and a DFA with every step: Thompson construction, λ-closure, subset construction and the minimal DFA.',
    h1: 'Regular expression to DFA converter',
    leadHtml: 'Type a regular expression such as <b>(a+b)*abb</b> above. Drawtomata builds the λ-NFA by Thompson’s construction, removes λ-moves, converts to a DFA by subset construction and minimizes it, showing the table for each step.',
    bodyHtml: `
<h2>The steps</h2>
<ol>
<li><b>RE → λ-NFA</b> (Thompson): one small NFA per symbol, joined with λ-moves for union (+), concatenation and star (*).</li>
<li><b>λ-NFA → NFA</b>: compute the λ-closure of every state and rebuild the moves without λ.</li>
<li><b>NFA → DFA</b>: subset construction, where each DFA state is a set of NFA states.</li>
<li><b>DFA → minimal DFA</b>: merge states that no string can tell apart, by the table-filling (mark) method or π-partitions.</li>
</ol>
<p>Each stage is checked against the others, so the final DFA is guaranteed to accept exactly the language of the expression.</p>
<h2>Syntax</h2>
<p>Use <b>+</b> for union, <b>*</b> for Kleene star, juxtaposition for concatenation and parentheses for grouping. Write the empty string as λ, ε or @, and the empty set as ∅. For example (0+1)*01, a(a+b)*b and (ab+ba)*.</p>
<h2>Questions</h2>
<h3>Why do different books get different NFAs for the same expression?</h3>
<p>Thompson’s construction adds λ-moves in a fixed pattern; some books shortcut it. The NFAs differ, but the minimal DFA is the same for every correct method, up to the names of the states.</p>
<h3>Can I go back from a DFA to a regular expression?</h3>
<p>Yes, with <a href="../fa-to-regex/">state elimination</a>.</p>`
  },
  {
    slug: 'dfa-minimization', tab: 'fa', op: 'min', example: 'minme',
    title: 'DFA Minimization Tool: Table Filling and Partition Method | Drawtomata',
    description: 'Minimize a DFA step by step with the table-filling (mark) method and the π-partition method, and get the minimal DFA with its diagram and table.',
    h1: 'DFA minimization',
    leadHtml: 'Draw a DFA above and press <b>Minimize</b>. Drawtomata removes unreachable states, then shows the marking table pass by pass and the π₀, π₁, … partitions, and draws the minimal DFA.',
    bodyHtml: `
<h2>Table-filling (mark) method</h2>
<ol>
<li>Remove states that cannot be reached from the start state.</li>
<li>Mark every pair (p, q) where one state is final and the other is not.</li>
<li>Repeat: mark (p, q) if for some symbol a the pair (δ(p, a), δ(q, a)) is already marked.</li>
<li>Pairs that are never marked are equivalent. Merge them.</li>
</ol>
<h2>Partition method</h2>
<p>Start with π₀ = {final states, non-final states}. Split a group whenever two of its states go to different groups on some symbol. Stop when a pass splits nothing: each group is one state of the minimal DFA.</p>
<h2>Example</h2>
<p>The DFA loaded above has five states, q0 to q4, over {a, b}. q0 and q2 can never be told apart, so they merge and the minimal DFA has four states. It accepts the strings that end in abb.</p>
<h2>Questions</h2>
<h3>Does the DFA need to be complete?</h3>
<p>For the textbook methods, yes. Missing moves are sent to a trap state first, and the tool shows it when it is needed.</p>
<h3>Is the minimal DFA unique?</h3>
<p>Yes. Every DFA for a regular language minimizes to the same machine, up to the names of the states.</p>`
  },
  {
    slug: 'epsilon-nfa-to-nfa', tab: 'fa', op: 'eps', example: 'lnfa',
    title: 'ε-NFA to NFA Converter (λ-closure), Step by Step | Drawtomata',
    description: 'Remove ε (λ) moves from an NFA step by step: λ-closure of every state, the new transition table and the equivalent NFA without ε-moves.',
    h1: 'ε-NFA to NFA converter',
    leadHtml: 'Draw an NFA with λ (ε) moves above and press <b>Remove λ</b>. Drawtomata computes the λ-closure of each state and builds the equivalent NFA without λ-moves.',
    bodyHtml: `
<h2>The method</h2>
<ol>
<li>For every state q, find λ-closure(q): q and every state reachable from q using only λ-moves.</li>
<li>For every state q and symbol a, the new move δ'(q, a) is λ-closure(δ(λ-closure(q), a)).</li>
<li>A state is final in the new NFA if its λ-closure contains a final state.</li>
</ol>
<p>The number of states stays the same; only the moves and the final states change.</p>
<h2>Questions</h2>
<h3>Is ε the same as λ?</h3>
<p>Yes. Linz writes λ and most other books write ε. Switch between them with the λ/ε button at the top of the page.</p>
<h3>Can I go straight to a DFA?</h3>
<p>Yes, use <a href="../nfa-to-dfa/">NFA to DFA</a>: subset construction handles λ-moves directly.</p>`
  },
  {
    slug: 'fa-to-regex', tab: 'fa', op: 're', example: 'endsab',
    title: 'DFA to Regular Expression Converter (State Elimination) | Drawtomata',
    description: 'Convert a DFA or NFA to a regular expression by state elimination, with the generalized transition graph after every removed state.',
    h1: 'Finite automaton to regular expression',
    leadHtml: 'Draw a DFA or NFA above and press <b>FA → RE</b>. Drawtomata turns it into a generalized transition graph and removes states one at a time, showing the new edge labels after each removal.',
    bodyHtml: `
<h2>State elimination</h2>
<ol>
<li>Make sure the start state has no incoming edges and there is a single final state, adding new ones joined by λ-moves if needed.</li>
<li>Pick a state q to remove. For every pair of neighbours p → q → r, replace the path with one edge labelled R(p,q) R(q,q)* R(q,r), joined by + to any edge p → r that is already there.</li>
<li>Repeat until only the start and final states remain. The label of the last edge is the regular expression.</li>
</ol>
<p>The order of elimination changes how the expression looks, not the language it describes. The result is checked against the automaton.</p>
<h2>Questions</h2>
<h3>Why is my answer different from the book’s?</h3>
<p>Different elimination orders give different, equally correct expressions. If the language matches, the answer is right.</p>`
  },
  {
    slug: 'first-and-follow', tab: 'parse', op: 'ff',
    title: 'FIRST and FOLLOW Calculator, Step by Step | Drawtomata',
    description: 'Compute FIRST and FOLLOW sets for any context-free grammar, with FIRST of every production and the sets after each pass.',
    h1: 'FIRST and FOLLOW calculator',
    leadHtml: 'Type a grammar above, one production per line, such as <b>E -> E + T | T</b>. Drawtomata computes FIRST and FOLLOW for every nonterminal and shows how the sets grow pass by pass.',
    bodyHtml: `
<h2>Rules</h2>
<p><b>FIRST(X)</b> is the set of terminals that can begin a string derived from X, plus ε if X can derive ε.</p>
<ul>
<li>For a terminal a, FIRST(a) = {a}.</li>
<li>For X → Y1 Y2 … Yk, add FIRST(Y1) − {ε}. If Y1 can vanish, add FIRST(Y2) − {ε}, and so on. If all of them can vanish, add ε.</li>
</ul>
<p><b>FOLLOW(A)</b> is the set of terminals that can appear right after A in some sentential form.</p>
<ul>
<li>Put $ in FOLLOW(S) for the start symbol S.</li>
<li>For A → αBβ, add FIRST(β) − {ε} to FOLLOW(B).</li>
<li>For A → αB, or A → αBβ where β can derive ε, add FOLLOW(A) to FOLLOW(B).</li>
</ul>
<p>Apply the rules until no set changes. FIRST and FOLLOW are what the <a href="../ll1-parser/">LL(1) table</a> and the <a href="../lr-parsing-table/">SLR table</a> are built from.</p>`
  },
  {
    slug: 'll1-parser', tab: 'parse', op: 'll1',
    title: 'LL(1) Parsing Table Generator and Parser, Step by Step | Drawtomata',
    description: 'Build the LL(1) parsing table for a grammar, see every conflict, and trace predictive parsing of an input string. Removes left recursion and left factors.',
    h1: 'LL(1) parsing table generator',
    leadHtml: 'Type a grammar above and Drawtomata builds the LL(1) table, marks conflicts and explains them, and traces a predictive parse of the input string. Left recursion removal and left factoring are one click away.',
    bodyHtml: `
<h2>Building the table</h2>
<ol>
<li>Compute <a href="../first-and-follow/">FIRST and FOLLOW</a>.</li>
<li>For each production A → α and each terminal a in FIRST(α), put A → α in M[A, a].</li>
<li>If ε is in FIRST(α), also put A → α in M[A, b] for every b in FOLLOW(A), including $.</li>
</ol>
<p>The grammar is LL(1) if no cell holds two productions.</p>
<h2>When a grammar is not LL(1)</h2>
<p>Left-recursive grammars such as E → E + T | T are never LL(1). Remove the left recursion first (E → T E', E' → + T E' | ε), and left factor alternatives that start the same way. Ambiguous grammars, such as the dangling else, stay in conflict whatever you do.</p>
<h2>Questions</h2>
<h3>What does the parse trace show?</h3>
<p>The stack, the remaining input and the action at every step: match a terminal, or expand a nonterminal with the production from the table.</p>`
  },
  {
    slug: 'lr-parsing-table', tab: 'parse', op: 'slr',
    title: 'LR(0), SLR, CLR and LALR Parsing Table Generator | Drawtomata',
    description: 'Generate LR(0) items, the SLR(1), canonical LR(1) and LALR(1) parsing tables, see shift-reduce and reduce-reduce conflicts, and trace a parse.',
    h1: 'SLR, CLR and LALR parsing table generator',
    leadHtml: 'Type a grammar above and choose LR(0), SLR(1), CLR(1) or LALR(1). Drawtomata builds the canonical collection of items, draws the automaton, fills in ACTION and GOTO, marks every conflict and traces a shift-reduce parse.',
    bodyHtml: `
<h2>Which table is which</h2>
<ul>
<li><b>LR(0)</b>: reduce on every terminal whenever an item A → α· is complete.</li>
<li><b>SLR(1)</b>: same LR(0) items, but reduce A → α only on the terminals in FOLLOW(A).</li>
<li><b>CLR(1)</b>: LR(1) items carry a lookahead, and A → α· [a] reduces only on a. Most powerful, most states.</li>
<li><b>LALR(1)</b>: merge LR(1) states with the same core. As many states as SLR, almost the power of CLR. This is what yacc builds.</li>
</ul>
<h2>Conflicts</h2>
<p>A shift-reduce conflict means a cell asks for both a shift and a reduce; a reduce-reduce conflict means two reductions. Ambiguous expression grammars can be fixed with yacc-style %left and %right precedence, which the tool applies when you tick the box.</p>
<h2>Classic examples</h2>
<p>S → CC, C → cC | d is LR(0) and so in every class. S → L = R | R, L → *R | id, R → L is LALR(1) but not SLR(1). Both are in the example list above.</p>`
  },
  {
    slug: 'cfg-to-pda', tab: 'cfg', op: 'pda',
    title: 'CFG to PDA Converter and PDA to CFG, Step by Step | Drawtomata',
    description: 'Convert a context-free grammar to an NPDA (Greibach normal form or general method), simulate it, and convert an NPDA back to a grammar.',
    h1: 'CFG to PDA converter',
    leadHtml: 'Type a grammar above. Drawtomata builds an equivalent NPDA, lets you run it on any string with instantaneous descriptions, and converts an NPDA back to a context-free grammar with the [qᵢ A qⱼ] construction.',
    bodyHtml: `
<h2>Grammar to NPDA</h2>
<p>If the grammar is in Greibach normal form, every production A → aX₁…Xₖ becomes one move: read a, pop A, push X₁…Xₖ. Otherwise the general method uses λ-moves to expand variables on the stack and plain moves to match terminals.</p>
<h2>NPDA to grammar</h2>
<p>The NPDA is first brought into a form where every move pops one symbol and pushes zero or two. Then the variable [qᵢ A qⱼ] stands for “go from qᵢ to qⱼ while popping A”, and each move gives productions. Useless productions are removed, and the grammar is checked against the NPDA on all short strings.</p>
<p>Also on the same tab: leftmost and rightmost derivations, parse trees and a bounded ambiguity search. Grammar simplification and Chomsky normal form are on the <a href="../first-and-follow/">parsing tab</a>.</p>`
  },
  {
    slug: 'pumping-lemma', tab: 'pump',
    title: 'Pumping Lemma for Regular Languages, Interactive | Drawtomata',
    description: 'Play the pumping lemma game: pick a language and a string, see every split xyz with |xy| ≤ p and the i that pumps it out of the language.',
    h1: 'Pumping lemma for regular languages',
    leadHtml: 'Pick a language such as aⁿbⁿ above. Drawtomata lists every way to split w into xyz with |xy| ≤ p and |y| ≥ 1, and the i for which xyⁱz leaves the language, so you can see why the language is not regular.',
    bodyHtml: `
<h2>The lemma</h2>
<p>If L is regular, there is a p ≥ 1 such that every w in L with |w| ≥ p can be written w = xyz with |xy| ≤ p and |y| ≥ 1, and xyⁱz is in L for every i ≥ 0.</p>
<h2>Using it as a game</h2>
<ol>
<li>The adversary picks p.</li>
<li>You pick a string w in L with |w| ≥ p. The choice matters: for aⁿbⁿ take w = aᵖbᵖ.</li>
<li>The adversary picks any split w = xyz with |xy| ≤ p and |y| ≥ 1.</li>
<li>You pick i so that xyⁱz is not in L. If you can do this for every split, L is not regular.</li>
</ol>
<p>For aⁿbⁿ, y lies inside the first p symbols, so it holds only a’s. Pumping changes the number of a’s but not of b’s, and i = 0 already breaks every split.</p>
<h2>Regular languages</h2>
<p>Switch to the regular mode and type a regular expression to see the other side: p is the number of states of the minimal DFA, and the pigeonhole principle gives a split that always pumps.</p>`
  },
  {
    slug: 'three-address-code', tab: 'cg', op: 'tac',
    title: 'Three-Address Code, DAG and Code Generation Tool | Drawtomata',
    description: 'Generate three-address code, quadruples, triples and indirect triples, the DAG of a basic block, SSA form, basic blocks, flow graphs, register allocation and peephole optimization.',
    h1: 'Three-address code and code generation',
    leadHtml: 'Type an expression such as <b>a = b * -c + b * -c</b> or a short program above. Drawtomata produces three-address code with quadruples, triples and indirect triples, and goes on to DAGs, SSA, basic blocks, liveness, target code and peephole optimization.',
    bodyHtml: `
<h2>Three-address code</h2>
<p>Every instruction has at most one operator and three addresses, such as t2 = b * t1. Temporaries hold intermediate results, in the order the expression is evaluated. For a = b * -c + b * -c:</p>
<table class="ex"><thead><tr><th>#</th><th>op</th><th>arg1</th><th>arg2</th><th>result</th></tr></thead><tbody>
<tr><td>0</td><td>minus</td><td>c</td><td></td><td>t1</td></tr>
<tr><td>1</td><td>*</td><td>b</td><td>t1</td><td>t2</td></tr>
<tr><td>2</td><td>minus</td><td>c</td><td></td><td>t3</td></tr>
<tr><td>3</td><td>*</td><td>b</td><td>t3</td><td>t4</td></tr>
<tr><td>4</td><td>+</td><td>t2</td><td>t4</td><td>t5</td></tr>
<tr><td>5</td><td>=</td><td>t5</td><td></td><td>a</td></tr>
</tbody></table>
<p>Triples drop the result column and refer to earlier results by their number; indirect triples add a list of pointers so an optimizer can reorder instructions.</p>
<h2>What else is on the tab</h2>
<ul>
<li>DAG of a block by the value-number method, and the shorter code rebuilt from it.</li>
<li>Static single-assignment form with φ-functions.</li>
<li>Leaders, basic blocks, the flow graph and natural loops.</li>
<li>Live variables and next-use information.</li>
<li>A simple code generator with register and address descriptors and instruction costs.</li>
<li>Peephole optimization of both three-address and target code.</li>
</ul>
<p>Every optimized program is run against the original on random inputs before it is shown.</p>`
  },
  {
    slug: 'syntax-directed-translation', tab: 'sdt', op: 'tree',
    title: 'Annotated Parse Tree and SDD Tool: S- and L-Attributed | Drawtomata',
    description: 'Write a syntax-directed definition and an input string to get the annotated parse tree, the dependency graph with a topological evaluation order, S-attributed and L-attributed checks, and the syntax tree.',
    h1: 'Annotated parse tree and syntax-directed translation',
    leadHtml: 'Type a grammar with semantic rules, such as <b>E -> E1 + T { E.val = E1.val + T.val }</b>, and an input string. Drawtomata parses the string, evaluates every attribute and draws the annotated parse tree, the dependency graph and the syntax tree.',
    bodyHtml: `
<h2>Synthesized and inherited attributes</h2>
<p>A <b>synthesized</b> attribute of a node is computed from its children, as in E.val = E1.val + T.val. An <b>inherited</b> attribute is computed from the parent and siblings, as in L.inh = T.type in a declaration. An SDD with only synthesized attributes is <b>S-attributed</b> and can be evaluated bottom-up during LR parsing. It is <b>L-attributed</b> when every inherited attribute of Xᵢ in A → X₁ … Xₙ uses only inherited attributes of A and attributes of X₁ … Xᵢ₋₁, so one depth-first, left-to-right pass evaluates it.</p>
<h2>Example: 3 * 5 + 4 n</h2>
<p>With the desk-calculator SDD loaded above, the annotated parse tree has F.val = 3 and F.val = 5 at the bottom, T.val = 15 above them, then E.val = 19 and finally L.val = 19 at the root.</p>
<table class="ex"><thead><tr><th>Production</th><th>Semantic rule</th></tr></thead><tbody>
<tr><td>L → E n</td><td>L.val = E.val</td></tr>
<tr><td>E → E1 + T</td><td>E.val = E1.val + T.val</td></tr>
<tr><td>E → T</td><td>E.val = T.val</td></tr>
<tr><td>T → T1 * F</td><td>T.val = T1.val * F.val</td></tr>
<tr><td>T → F</td><td>T.val = F.val</td></tr>
<tr><td>F → ( E )</td><td>F.val = E.val</td></tr>
<tr><td>F → digit</td><td>F.val = digit.lexval</td></tr>
</tbody></table>
<h2>Dependency graph and evaluation order</h2>
<p>Each attribute of each parse-tree node is a node of the dependency graph, with an edge from X.a to Y.b whenever the rule for Y.b reads X.a. Any topological sort of the graph is a valid evaluation order; if the graph has a cycle, no order exists. The tool numbers one order and lists the value computed at each step.</p>
<h2>Syntax trees</h2>
<p>Rules such as E.node = new Node('+', E1.node, T.node) and T.node = new Leaf(id, id.entry) build a syntax tree while the attributes are evaluated. For a - 4 + c the tool shows the five steps p1 … p5 and draws the tree.</p>`
  }
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const NAV = [
  ['nfa-to-dfa', 'NFA to DFA'], ['regex-to-dfa', 'Regex to DFA'], ['dfa-minimization', 'DFA minimization'],
  ['epsilon-nfa-to-nfa', 'ε-NFA to NFA'], ['fa-to-regex', 'FA to regex'], ['first-and-follow', 'FIRST and FOLLOW'],
  ['ll1-parser', 'LL(1) table'], ['lr-parsing-table', 'SLR, CLR, LALR'], ['cfg-to-pda', 'CFG to PDA'],
  ['pumping-lemma', 'Pumping lemma'], ['syntax-directed-translation', 'Annotated parse tree'], ['three-address-code', 'Three-address code']
];
const toolLinks = (prefix, current) => `<nav class="seoNav" aria-label="All converters"><h2>All converters</h2><ul>${NAV.map(([s, t]) => `<li>${s === current ? `<span aria-current="page">${t}</span>` : `<a href="${prefix}${s}/">${t}</a>`}</li>`).join('')}</ul></nav>`;

function homeFooter() {
  return `<!-- converter pages: generated by scripts/build-pages.js -->
<footer class="seo">${toolLinks('', null)}<p class="seoMeta">Drawtomata is free and runs in your browser. <a href="https://github.com/SlazzInC0de/drawtomata">Source on GitHub</a>.</p></footer>
<!-- /converter pages -->`;
}

function build() {
  assertInsideRepo(INDEX_FILE);
  let html = fs.readFileSync(INDEX_FILE, 'utf8'); // nosemgrep: INDEX_FILE is a constant path inside the repository
  // keep the link list on the home page current
  html = html.replace(/<!-- converter pages: generated[\s\S]*?<!-- \/converter pages -->/, homeFooter());
  const out = { 'index.html': html };
  for (const p of PAGES) {
    const url = `${SITE}/${p.slug}/`;
    let h = html;
    const rep = (re, s) => { if (!re.test(h)) throw new Error(`${p.slug}: pattern ${re} not found`); h = h.replace(re, s); };
    rep(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`);
    rep(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.description)}">`);
    rep(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`); // keeps the nosemgrep note after it
    rep(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(p.h1)} | Drawtomata">`);
    rep(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(p.description)}">`);
    rep(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`);
    const ld = { '@context': 'https://schema.org', '@type': 'WebApplication', name: p.h1.charAt(0).toUpperCase() + p.h1.slice(1), url, applicationCategory: 'EducationalApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript', offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' }, description: p.description, isPartOf: { '@type': 'WebSite', name: 'Drawtomata', url: SITE + '/' }, author: { '@type': 'Person', name: 'Suryansh Verma', url: 'https://github.com/SlazzInC0de' } };
    rep(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
    // assets live one folder up
    h = h.replace(/(href|src)="(assets|css|js)\//g, '$1="../$2/');
    // the page's own heading is the H1; the brand goes back to the home page
    rep(/<h1 class="brandH"><a class="brand" href="#re" data-goto="re" aria-label="Drawtomata home">([\s\S]*?)<\/a><\/h1>/, '<div class="brandH"><a class="brand" href="../" aria-label="Drawtomata home">$1</a></div>');
    rep(/<body>/, `<body data-tab="${p.tab}"${p.op ? ` data-op="${p.op}"` : ''}${p.example ? ` data-example="${p.example}"` : ''}>`);
    const article = `<article class="seo" id="how">
<p class="seoCrumb"><a href="../">Drawtomata</a> / ${esc(p.h1)}</p>
<h1>${p.h1.charAt(0).toUpperCase() + p.h1.slice(1)}</h1>
<p class="seoLead">${p.leadHtml}</p>
${p.bodyHtml.trim()}
</article>`;
    rep(/<!-- converter pages: generated[\s\S]*?<!-- \/converter pages -->/, `<!-- converter pages: generated by scripts/build-pages.js -->\n${article}\n<footer class="seo">${toolLinks('../', p.slug)}<p class="seoMeta">Drawtomata is free and runs in your browser. <a href="https://github.com/SlazzInC0de/drawtomata">Source on GitHub</a>.</p></footer>\n<!-- /converter pages -->`);
    out[`${p.slug}/index.html`] = h;
  }
  out['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['', ...PAGES.map((p) => p.slug + '/')].map((u) => `  <url>
    <loc>${SITE}/${u}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u ? '0.9' : '1.0'}</priority>
  </url>`).join('\n')}
</urlset>
`;
  return out;
}

// Every file the build may write, fixed by the PAGES list above.
function allowedOutputs() {
  return new Set(['index.html', 'sitemap.xml', ...PAGES.map((p) => `${p.slug}/index.html`)]);
}

// Throws unless p, after following symlinks in every existing part of it, is inside
// the repository. A path that does not exist yet is judged by its nearest existing parent.
function assertInsideRepo(p) {
  const realRoot = fs.realpathSync(root);
  let probe = p;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- only checks existence
  while (!fs.existsSync(probe)) probe = path.dirname(probe); // nosemgrep
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- only resolves the path
  const real = fs.realpathSync(probe); // nosemgrep
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`refusing to touch a path outside the repository: ${p}`);
}

// Checks an output name against the allowlist and returns its absolute path.
function outputPath(name) {
  if (!allowedOutputs().has(name)) throw new Error(`refusing to write unexpected file ${name}`);
  const full = path.resolve(root, ...name.split('/')); // nosemgrep: name is one of the fixed outputs above
  if (!full.startsWith(root + path.sep)) throw new Error(`refusing to write outside the repository: ${name}`);
  return full;
}

function writeOutput(name, text) {
  const full = outputPath(name);
  assertInsideRepo(full);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked by outputPath() and assertInsideRepo()
  fs.mkdirSync(path.dirname(full), { recursive: true }); // nosemgrep
  assertInsideRepo(path.dirname(full));
  let st = null;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked by outputPath() and assertInsideRepo()
  try { st = fs.lstatSync(full); } catch (e) { if (e.code !== 'ENOENT') throw e; } // nosemgrep
  if (st && !st.isFile()) throw new Error(`refusing to write ${name}: it is not a regular file (symlink?)`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked by outputPath() and assertInsideRepo()
  fs.writeFileSync(full, text); // nosemgrep
}

for (const p of PAGES) if (!SLUG.test(p.slug)) throw new Error(`bad page slug ${p.slug}`);

module.exports = { build, PAGES, outputPath, assertInsideRepo };
if (require.main === module) {
  const out = build();
  for (const [name, text] of Object.entries(out)) writeOutput(name, text);
  console.log(`wrote ${Object.keys(out).length} files`);
}
