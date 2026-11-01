# Contributing

Drawtomata's value is that its answers are right. These rules keep it that way, for people and for coding agents alike.

## Where code goes

| Need | Use | Do not |
| --- | --- | --- |
| Empty-string spellings (λ, ε, eps, …) | `DT.core.EPS_WORDS`, `DT.core.EPS_CHARS`, `DT.isEps` in `js/core.js` | define another list |
| Reading grammar text (`A -> α \| β`, continuation lines, comments) | `DT.core.readProductions` | write another line splitter |
| Nullable nonterminals | `DT.core.nullableSet` | recompute it inline |
| Arithmetic expressions (`a + b * -c`, `x[i]`, relops) | `DT.core.parseExpr` with your own `node` and `error` hooks | write another precedence parser |
| Automata (Thompson, subset, minimize, equivalence, products) | `DT.fa` in `js/automata.js` | copy an algorithm into a tool file |
| FIRST/FOLLOW, LL(1), LR tables, LR driver | `DT.parsing` in `js/parsing.js` | build a second table or driver |
| UI for one tool | that tool's file in `js/ui/` | edit another tool's file for a fix that is not about it |
| Helpers used by several tools | `js/ui/common.js`, shared through `DT.app` | copy the helper into each tool |

If a shared function is almost what you need, extend it and keep its old behaviour, rather than writing a near copy.

## Checks before a commit

```
npm test                        # unit tests, textbook checks, golden snapshots
node scripts/build-pages.js     # after any change to index.html
```

`tests/golden/*.json` holds the full output of every engine on fixed inputs. If a golden test fails, the message names the first value that changed. Then either:

- the change was not intended: fix the code, or
- it was intended: run `node tests/golden.js --update`, read the diff of `tests/golden/` and say in the commit message why the output changed.

Never update the snapshots just to make the tests pass.

## Adding a converter

1. Put the algorithm in an engine file (`js/*.js`), using the shared core above.
2. Add its outputs to `collect()` in `tests/golden.js` and run `--update`.
3. Add at least one cross-check (language equivalence, a brute-force comparison, or running the result) to `tests/run.js`.
4. If a textbook has a worked example, add it to `js/textbook.js`; it then appears on `/verified/`.
5. Put the UI in a new `js/ui/<tool>.js` and add its `<script>` tag to `index.html` before `js/ui/boot.js`.
