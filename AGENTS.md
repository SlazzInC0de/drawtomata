# Notes for coding agents

Read CONTRIBUTING.md first and follow it. In short:

- Reuse `js/core.js`, `DT.fa` and `DT.parsing`; do not add a second parser, empty-string list or table builder.
- Change only the tool you were asked about; each tool's UI is in its own file in `js/ui/`.
- Run `npm test`. If a golden snapshot fails and the change was not asked for, fix the code instead of running `node tests/golden.js --update`.
- Commits are authored by the repository owner; do not add co-author lines or tool names to files, folders or commit messages.
