# Security Policy

## Supported versions

Only the latest version on the `main` branch, which is what <https://drawtomata.vercel.app/> serves, receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report it privately by either:

- using **Report a vulnerability** under this repository's **Security** tab, or
- emailing **vsuryansh080405@gmail.com** with the subject `[drawtomata] Security report`.

Include:

- what the issue is and where it lives (page, file, input)
- steps or a minimal input that reproduces it
- the impact you expect (for example, script injection through a grammar, regex or imported JSON)

## What to expect

- An acknowledgement within 7 days.
- A fix or a clear decision within 30 days for confirmed issues, depending on severity.
- Credit in the fix commit if you would like it.

## Scope

Drawtomata runs entirely in the browser. It has no backend, no accounts and sends no user data anywhere. Things that are in scope:

- XSS or HTML injection through any input, rendered output, KaTeX output or imported JSON
- bypasses of the Content Security Policy or other headers in `vercel.json`
- vulnerable dependencies shipped to the browser

Out of scope: issues that need a compromised browser or device, and reports from automated scanners without a working proof of concept.
