/* Syntax-directed translation (Aho ch. 5): SDDs with semantic rules, annotated
   parse trees, dependency graphs and evaluation order, S- and L-attributed
   checks, and syntax-tree construction with Node / Leaf. */
(function (DT) {
  'use strict';
  const EPSW = new Set(['ε', 'λ', 'eps', 'epsilon', '@']);
  const isNTName = (s) => /^[A-Z]/.test(s);
  // E1 and T1' stand for occurrences of E and T'
  const baseOf = (s) => { const m = s.match(/^([A-Za-z][A-Za-z_]*?)(\d+)('*)$/); return m ? m[1] + m[3] : s; };
  // position 0 is the head of a production, 1..n its body symbols
  const occAt = (node, pos) => (pos === 0 ? node : node.kids[pos - 1]);
  const ARITH = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b };

  // ---------- expressions inside { … } ----------
  function lexExpr(s) {
    const out = [];
    const re = /\s*(?:(\d+\.\d+|\d+)|'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*'*\.[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*'*)|(\|\||[-+*/(),=;]))/y;
    let i = 0;
    while (i < s.length) {
      if (/^\s*$/.test(s.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) throw new Error(`Cannot read "${s.slice(i).trim()}" in a semantic rule.`);
      if (m[1] !== undefined) out.push({ t: 'num', v: +m[1] });
      else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'str', v: m[2] ?? m[3] });
      else if (m[4] !== undefined) out.push(m[4].includes('.') ? { t: 'attr', sym: m[4].split('.')[0], attr: m[4].split('.')[1] } : { t: 'name', v: m[4] });
      else out.push({ t: 'op', v: m[5] });
      i = re.lastIndex;
    }
    return out;
  }
  function parseExpr(toks) {
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const eat = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}" in a semantic rule.`); p++; };
    function primary() {
      const t = toks[p++];
      if (!t) throw new Error('A semantic rule ends too early.');
      if (t.t === 'num' || t.t === 'str') return { k: 'lit', v: t.v };
      if (t.t === 'attr') return { k: 'attr', sym: t.sym, attr: t.attr };
      if (t.t === 'op' && t.v === '(') { const e = cat(); eat(')'); return e; }
      if (t.t === 'op' && t.v === '-') return { k: 'neg', a: primary() };
      if (t.t === 'name') return nameOrCall(t.v);
      throw new Error(`Unexpected "${t.v}" in a semantic rule.`);
    }
    // a bare name, a call f(a, b), or new Node(...)
    function nameOrCall(first) {
      const name = first === 'new' && peek() && peek().t === 'name' ? toks[p++].v : first;
      if (!isOp('(')) return { k: 'lit', v: name };
      p++;
      const args = [];
      if (!isOp(')')) { args.push(cat()); while (isOp(',')) { p++; args.push(cat()); } }
      eat(')');
      return { k: 'call', f: name, args };
    }
    function mul() { let l = primary(); while (isOp('*') || isOp('/')) { const op = toks[p++].v; l = { k: 'bin', op, l, r: primary() }; } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { k: 'bin', op, l, r: mul() }; } return l; }
    function cat() { let l = add(); while (isOp('||')) { p++; l = { k: 'bin', op: '||', l, r: add() }; } return l; }
    const e = cat();
    if (p !== toks.length) throw new Error(`Unexpected "${toks[p].v}" in a semantic rule.`);
    return e;
  }
  const refsOf = (e, out = []) => {
    if (e.k === 'attr') out.push(e);
    else if (e.k === 'bin') { refsOf(e.l, out); refsOf(e.r, out); } else if (e.k === 'neg') refsOf(e.a, out);
    else if (e.k === 'call') e.args.forEach((a) => refsOf(a, out));
    return out;
  };
  const exprStr = (e) => {
    switch (e.k) {
      case 'lit': return typeof e.v === 'number' ? String(e.v) : e.v;
      case 'attr': return `${e.sym}.${e.attr}`;
      case 'neg': return `-${exprStr(e.a)}`;
      case 'bin': return `${exprStr(e.l)} ${e.op} ${exprStr(e.r)}`;
      case 'call': return `${e.f}(${e.args.map(exprStr).join(', ')})`;
      default: return '?';
    }
  };

  // ---------- the SDD ----------
  // E -> E1 + T { E.val = E1.val + T.val }   alternatives may be split with |
  // join continuation lines (starting with | or ->, or without an arrow) onto the production above
  function joinLines(text) {
    const lines = [];
    for (const raw of text.split('\n')) {
      const s = raw.replace(/\/\/.*$/, '').trim();
      if (!s) continue;
      if (/^(->|→|::=|\|)/.test(s) || !/(->|→|::=)/.test(s)) {
        if (!lines.length) throw new Error(`Line "${s}" does not start a production.`);
        lines[lines.length - 1] += ' ' + s;
      } else lines.push(s);
    }
    return lines;
  }
  // split alternatives on | outside braces
  function splitAlts(rhs) {
    const alts = [];
    let depth = 0, cur = '';
    for (const ch of rhs) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === '|' && depth === 0) { alts.push(cur); cur = ''; } else cur += ch;
    }
    alts.push(cur);
    return alts;
  }
  function parseRule(r) {
    const toks = lexExpr(r);
    if (toks.length > 2 && toks[0].t === 'attr' && toks[1].t === 'op' && toks[1].v === '=') {
      return { target: { sym: toks[0].sym, attr: toks[0].attr }, expr: parseExpr(toks.slice(2)), text: r };
    }
    return { target: null, expr: parseExpr(toks), text: r }; // an action such as addType(id.entry, L.inh)
  }
  function parseAlt(line, lhs, alt) {
    const b = alt.indexOf('{');
    if (b >= 0 && alt.lastIndexOf('}') < b) throw new Error(`"${line}": a { has no matching }.`);
    const body = (b < 0 ? alt : alt.slice(0, b)).trim();
    const ruleText = b < 0 ? '' : alt.slice(b + 1, alt.lastIndexOf('}'));
    const rhs = body.split(/\s+/).filter((x) => x && !EPSW.has(x));
    const rules = ruleText.split(';').map((r) => r.trim()).filter(Boolean).map(parseRule);
    return { lhs, rhs, rules };
  }
  function parseSDD(text) {
    const prods = [];
    for (const line of joinLines(text)) {
      const m = line.match(/^(\S+)\s*(?:->|→|::=)\s*([\s\S]*)$/);
      if (!m || !isNTName(m[1])) throw new Error(`"${line}": the left side must be a nonterminal (capital letter).`);
      for (const alt of splitAlts(m[2])) prods.push(parseAlt(line, m[1], alt));
    }
    if (!prods.length) throw new Error('Write at least one production.');
    const nts = [...new Set(prods.map((p) => p.lhs))];
    const ntSet = new Set(nts);
    // name every occurrence: the LHS is position 0, RHS symbols 1..n; E1 means an occurrence of E
    prods.forEach((p, pi) => {
      p.sym = p.rhs.map((s) => (!ntSet.has(s) && ntSet.has(baseOf(s)) ? baseOf(s) : s));
      const occ = new Map([[p.lhs, 0]]);
      const dup = new Set();
      p.rhs.forEach((s, i) => { if (occ.has(s)) dup.add(s); else occ.set(s, i + 1); });
      const where = (name) => {
        if (dup.has(name)) throw new Error(`Production ${pi + 1} (${p.lhs} → ${p.rhs.join(' ')}): "${name}" appears more than once; write ${name}1, ${name}2 for the copies.`);
        if (!occ.has(name)) throw new Error(`Production ${pi + 1} (${p.lhs} → ${p.rhs.join(' ') || 'ε'}): "${name}" is not a symbol of this production.`);
        return occ.get(name);
      };
      p.rules.forEach((r, ri) => {
        r.pos = r.target ? where(r.target.sym) : 0;
        r.attr = r.target ? r.target.attr : `action${ri + 1}`;
        r.refs = refsOf(r.expr).map((a) => ({ pos: where(a.sym), attr: a.attr, name: `${a.sym}.${a.attr}` }));
      });
    });
    const terms = [...new Set(prods.flatMap((p) => p.sym.filter((s) => !ntSet.has(s))))];
    return { prods, start: prods[0].lhs, nts, terms, ntSet };
  }
  const prodStr = (p) => `${p.lhs} → ${p.rhs.join(' ') || 'ε'}`;

  // ---------- S- and L-attributed ----------
  function ruleKind(r) {
    if (r.pos > 0) return 'inherited';
    return r.target ? 'synthesized' : 'action';
  }
  // why an inherited rule breaks the L-attributed condition, or '' if it does not
  function refViolation(p, r, ref, inh) {
    if (ref.pos === 0 && !(inh.get(p.lhs) || new Set()).has(ref.attr)) return `uses ${ref.name}, a synthesized attribute of the head`;
    if (ref.pos > r.pos) return `uses ${ref.name}, which is to the right of ${p.rhs[r.pos - 1]}`;
    if (ref.pos === r.pos && ref.attr === r.attr) return `${r.target.sym}.${r.attr} depends on itself`;
    return '';
  }
  function lViolation(p, r, inh) {
    for (const ref of r.refs) {
      const why = refViolation(p, r, ref, inh);
      if (why) return why;
    }
    return '';
  }
  function classify(sdd) {
    const syn = new Map(), inh = new Map();
    const add = (m, s, a) => { if (!m.has(s)) m.set(s, new Set()); m.get(s).add(a); };
    for (const p of sdd.prods) for (const r of p.rules) {
      if (!r.target) continue;
      const s = r.pos === 0 ? p.lhs : p.sym[r.pos - 1];
      add(r.pos === 0 ? syn : inh, s, r.attr);
    }
    const lFails = [];
    const rows = [];
    for (const p of sdd.prods) for (const r of p.rules) {
      const why = r.pos > 0 ? lViolation(p, r, inh) : '';
      if (why) lFails.push({ p, r, why });
      rows.push({ p, r, kind: ruleKind(r), ok: !why, why });
    }
    const S = rows.every((x) => x.kind !== 'inherited');
    return { syn, inh, rows, S, L: !lFails.length, lFails };
  }

  // ---------- input and parsing (Earley, so any grammar works) ----------
  function tokenize(w, sdd) {
    const terms = new Set(sdd.terms);
    const raw = w.match(/\d+\.\d+|\d+|[A-Za-z_][A-Za-z0-9_]*|\S/g) || [];
    return raw.map((t) => {
      if (terms.has(t)) return { term: t, text: t };
      if (/^\d/.test(t)) {
        const k = ['digit', 'num', 'number', 'int_const', 'const'].find((x) => terms.has(x) && (x !== 'digit' || /^\d$/.test(t)));
        if (k) return { term: k, text: t, num: +t };
        if (terms.has('digit') && /^\d+$/.test(t)) throw new Error(`"${t}" has more than one digit, but the grammar only has digit. Separate the digits or use num.`);
      }
      if (/^[A-Za-z_]/.test(t) && terms.has('id')) return { term: 'id', text: t };
      throw new Error(`"${t}" does not match any terminal of the grammar (${sdd.terms.join(', ')}).`);
    });
  }
  const addItem = (set, it) => { const k = `${it.p},${it.d},${it.o}`; if (set.has(k)) return false; set.set(k, it); return true; };
  const advance = (it, kid) => ({ ...it, d: it.d + 1, kids: [...it.kids, kid] });
  // nullable nonterminals, each with a function building one ε-tree for it
  function nullableTrees(prods) {
    const epsTree = new Map();
    const canAdd = (p) => !epsTree.has(p.lhs) && p.sym.every((s) => epsTree.has(s));
    let p = prods.find(canAdd);
    while (p) {
      const prod = p, i = prods.indexOf(p);
      epsTree.set(prod.lhs, () => ({ sym: prod.lhs, prod: i, kids: prod.sym.map((s) => epsTree.get(s)()) }));
      p = prods.find(canAdd);
    }
    return epsTree;
  }
  function predict(it, X, i, byLhs, epsTree, push) {
    for (const pi of byLhs.get(X) || []) push({ p: pi, d: 0, o: i, kids: [] });
    if (epsTree.has(X)) push(advance(it, epsTree.get(X)()));
  }
  function complete(origin, pr, node, push) {
    for (const w of [...origin.values()]) {
      if (pr(w.p).sym[w.d] === node.sym) push(advance(w, node));
    }
  }
  function parse(sdd, toks) {
    const { prods, ntSet } = sdd;
    const byLhs = new Map();
    prods.forEach((p, i) => { if (!byLhs.has(p.lhs)) byLhs.set(p.lhs, []); byLhs.get(p.lhs).push(i); });
    // nullable nonterminals and one ε-tree for each
    const epsTree = nullableTrees(prods);
    const S = [new Map()];
    const START = -1;
    const pr = (i) => (i === START ? { lhs: "S'", sym: [sdd.start] } : prods[i]);
    addItem(S[0], { p: START, d: 0, o: 0, kids: [] });
    for (let i = 0; i <= toks.length && S[i]; i++) {
      const set = S[i];
      const queue = [...set.values()];
      const push = (n) => { if (addItem(set, n)) queue.push(n); };
      while (queue.length) {
        const it = queue.shift();
        const P = pr(it.p);
        const X = P.sym[it.d];
        if (X === undefined) complete(S[it.o], pr, { sym: P.lhs, prod: it.p, kids: it.kids }, push);
        else if (ntSet.has(X)) predict(it, X, i, byLhs, epsTree, push);
        else if (i < toks.length && toks[i].term === X) {
          if (!S[i + 1]) S[i + 1] = new Map();
          addItem(S[i + 1], advance(it, { sym: X, tok: toks[i], kids: null }));
        }
      }
    }
    const last = S[toks.length];
    const done = last && [...last.values()].find((it) => it.p === START && it.d === 1 && it.o === 0);
    if (!done) {
      let k = 0;
      while (k < toks.length && S[k + 1]) k++;
      throw new Error(k < toks.length ? `The string is not in the language: parsing stops at "${toks[k].text}" (token ${k + 1}).` : 'The string is not in the language: it ends too early.');
    }
    // number the nodes in preorder
    const root = done.kids[0];
    let id = 0;
    const walk = (n, parent) => { n.id = id++; n.parent = parent; (n.kids || []).forEach((c) => walk(c, n)); };
    walk(root, null);
    return root;
  }
  const preorder = (root) => { const out = []; const w = (n) => { out.push(n); (n.kids || []).forEach(w); }; w(root); return out; };
  const yieldOf = (root) => preorder(root).filter((n) => n.tok).map((n) => n.tok.text);

  // ---------- attribute instances, dependency graph, evaluation ----------
  const TOKEN_ATTRS = ['lexval', 'val', 'value', 'entry', 'lexeme', 'name', 'text'];
  function tokenAttr(n, attr) {
    if (!TOKEN_ATTRS.includes(attr)) return undefined;
    if (n.tok.num !== undefined && ['lexval', 'val', 'value'].includes(attr)) return n.tok.num;
    return n.tok.text;
  }
  function instances(sdd, root) {
    const nodes = preorder(root);
    const inst = new Map(); // key "nodeId.attr"
    const key = (n, a) => `${n.id}.${a}`;
    const order = [];
    for (const n of nodes) {
      if (n.tok) continue;
      const p = sdd.prods[n.prod];
      p.rules.forEach((r) => {
        const owner = occAt(n, r.pos);
        const k = key(owner, r.attr);
        if (inst.has(k) && inst.get(k).rule) throw new Error(`${owner.sym}.${r.attr} is defined twice for the same node.`);
        inst.set(k, { key: k, node: owner, attr: r.attr, rule: r, at: n, deps: [], action: !r.target });
        order.push(k);
      });
    }
    // dependencies; token attributes are leaves of the graph
    for (const k of order) {
      const I = inst.get(k);
      const p = sdd.prods[I.at.prod];
      for (const ref of I.rule.refs) {
        const owner = occAt(I.at, ref.pos);
        const rk = key(owner, ref.attr);
        if (!inst.has(rk)) {
          if (owner.tok && tokenAttr(owner, ref.attr) !== undefined) inst.set(rk, { key: rk, node: owner, attr: ref.attr, deps: [], token: true, value: tokenAttr(owner, ref.attr) });
          else throw new Error(`${ref.name} is used in "${I.rule.text}" (${prodStr(p)}), but no rule gives it a value${owner.parent === null ? ' at the root of the tree' : ''}.`);
        }
        I.deps.push(rk);
      }
    }
    return { inst, nodes };
  }
  function topoOrder(inst) {
    const keys = [...inst.keys()];
    const rank = (k) => { const [n, a] = k.split('.'); return [+n, a]; };
    keys.sort((a, b) => { const [n1, a1] = rank(a), [n2, a2] = rank(b); return n1 - n2 || a1.localeCompare(a2); });
    const indeg = new Map(keys.map((k) => [k, inst.get(k).deps.length]));
    const users = new Map(keys.map((k) => [k, []]));
    keys.forEach((k) => inst.get(k).deps.forEach((d) => users.get(d).push(k)));
    const ready = keys.filter((k) => !indeg.get(k));
    const out = [];
    while (ready.length) {
      const k = ready.shift();
      out.push(k);
      for (const u of users.get(k)) { indeg.set(u, indeg.get(u) - 1); if (!indeg.get(u)) { ready.push(u); ready.sort((a, b) => keys.indexOf(a) - keys.indexOf(b)); } }
    }
    const cyclic = keys.filter((k) => indeg.get(k) > 0);
    return { order: out, cyclic };
  }

  // values: numbers, strings, and syntax-tree nodes made by Node / Leaf
  function evaluator() {
    const tree = [];
    const actions = [];
    const isNode = (v) => Boolean(v) && typeof v === 'object' && v.sn !== undefined;
    const show = (v) => {
      if (isNode(v)) return `p${v.sn + 1}`;
      if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
      return String(v);
    };
    const callText = (e, args) => `${e.f}(${args.map(show).join(', ')})`;
    function makeNode(e, f, args) {
      const rest = args.slice(1);
      const leaf = f === 'leaf' || f === 'mkleaf' || !rest.some(isNode);
      const n = { sn: tree.length, label: show(args[0]), leaf, kids: leaf ? [] : rest.filter(isNode), extra: leaf ? rest.map(show) : [], call: callText(e, args) };
      tree.push(n);
      return n;
    }
    const NODE_FNS = new Set(['node', 'mknode', 'leaf', 'mkleaf']);
    const ACTION_FNS = new Set(['gen', 'emit', 'print', 'addtype', 'enter', 'add_type']);
    function evCall(e, look) {
      const args = e.args.map((x) => ev(x, look));
      const f = e.f.toLowerCase();
      if (NODE_FNS.has(f)) return makeNode(e, f, args);
      if (ACTION_FNS.has(f)) { const text = callText(e, args); actions.push(text); return text; }
      if (f === 'max') return Math.max(...args);
      if (f === 'min') return Math.min(...args);
      throw new Error(`Unknown function ${e.f}(). Supported: Node, Leaf, mknode, mkleaf, addType, gen, print, max, min.`);
    }
    function evBin(e, look) {
      const a = ev(e.l, look), b = ev(e.r, look);
      if (e.op === '||') return show(a) + show(b);
      if (typeof a !== 'number' || typeof b !== 'number') throw new Error(`Cannot compute ${show(a)} ${e.op} ${show(b)}: both sides must be numbers.`);
      if (e.op === '/' && b === 0) throw new Error(`Division by zero: ${show(a)} / 0.`);
      return ARITH[e.op](a, b);
    }
    function ev(e, look) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'attr': return look(e);
        case 'neg': { const a = ev(e.a, look); if (typeof a !== 'number') throw new Error(`Cannot negate "${show(a)}".`); return -a; }
        case 'bin': return evBin(e, look);
        case 'call': return evCall(e, look);
        default: throw new Error('bad expression');
      }
    }
    return { ev, tree, actions, show };
  }
  function evaluate(sdd, root) {
    const { inst, nodes } = instances(sdd, root);
    const { order, cyclic } = topoOrder(inst);
    if (cyclic.length) {
      const names = cyclic.slice(0, 6).map((k) => { const I = inst.get(k); return `${I.node.sym}.${I.attr} (node ${I.node.id})`; });
      return { inst, nodes, order, cyclic, error: `The dependency graph has a cycle through ${names.join(', ')}, so no evaluation order exists.` };
    }
    const E = evaluator();
    const steps = [];
    for (const k of order) {
      const I = inst.get(k);
      if (I.token) { steps.push({ k, I, value: I.value }); continue; }
      const refs = I.rule.refs;
      let ri = 0;
      const look = () => { const ref = refs[ri++]; return inst.get(`${occAt(I.at, ref.pos).id}.${ref.attr}`).value; };
      I.value = E.ev(I.rule.expr, look);
      steps.push({ k, I, value: I.value });
    }
    return { inst, nodes, order, cyclic, steps, tree: E.tree, actions: E.actions, show: E.show };
  }
  // the order refs are visited by ev() matches refsOf(), so look() can hand them out in sequence

  // one depth-first, left-to-right pass (the L-attributed evaluator); null if it ever needs a value too early
  function onePass(sdd, root, postOnly) {
    const { inst } = instances(sdd, root);
    const E = evaluator();
    const val = new Map();
    for (const [k, I] of inst) if (I.token) val.set(k, I.value);
    const evalRule = (I) => {
      let ri = 0;
      const look = () => {
        const ref = I.rule.refs[ri++];
        const rk = `${occAt(I.at, ref.pos).id}.${ref.attr}`;
        if (!val.has(rk)) throw Object.assign(new Error('too early'), { early: `${I.node.sym}.${I.attr} needs ${ref.name} before it is known` });
        return val.get(rk);
      };
      val.set(I.key, E.ev(I.rule.expr, look));
    };
    const rulesAt = (n) => [...inst.values()].filter((I) => I.at === n && I.rule);
    // rules of one group may come in any textual order: keep going while something can be computed
    const group = (list) => {
      let pending = list, last = null;
      while (pending.length) {
        const next = [];
        for (const I of pending) {
          try { evalRule(I); } catch (e) {
            if (!e.early) throw e;
            last = e;
            next.push(I);
          }
        }
        if (next.length === pending.length) throw last;
        pending = next;
      }
    };
    const visit = (n) => {
      if (n.tok) return;
      const mine = rulesAt(n);
      n.kids.forEach((c, i) => {
        if (!postOnly) group(mine.filter((I) => I.rule.pos === i + 1));
        visit(c);
      });
      group(mine.filter((I) => postOnly || I.rule.pos === 0));
    };
    try { visit(root); } catch (e) { if (e.early) return { ok: false, stuck: e.early }; throw e; }
    return { ok: true, val, actions: E.actions };
  }
  function sameValues(res, pass) {
    for (const [k, I] of res.inst) {
      if (I.token) continue;
      const a = res.show(I.value), b = pass.val.has(k) ? res.show(pass.val.get(k)) : undefined;
      if (a !== b) return { ok: false, what: `${I.node.sym}.${I.attr}`, a, b };
    }
    return { ok: true };
  }

  function run(text, input) {
    const sdd = parseSDD(text);
    const cls = classify(sdd);
    const toks = tokenize(input, sdd);
    const root = parse(sdd, toks);
    const res = evaluate(sdd, root);
    const yieldOk = yieldOf(root).join(' ') === toks.map((t) => t.text).join(' ');
    let respects = true;
    if (!res.error) {
      const pos = new Map(res.order.map((k, i) => [k, i]));
      for (const [k, I] of res.inst) for (const d of I.deps) if (pos.get(d) > pos.get(k)) respects = false;
    }
    let check = null;
    if (!res.error) {
      const kind = cls.S ? 'post' : 'dfs';
      const pass = onePass(sdd, root, cls.S);
      check = pass.ok ? { ...sameValues(res, pass), kind } : { ok: false, stuck: pass.stuck, kind };
    }
    return { sdd, cls, toks, root, res, yieldOk, respects, check };
  }

  DT.sdt = { parseSDD, classify, tokenize, parse, evaluate, onePass, run, prodStr, exprStr, preorder, yieldOf, baseOf };
})(typeof window !== 'undefined' ? window.DT : globalThis.DT);
