# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub security advisories (Security tab, "Report a vulnerability") or by email to christian@christianstrunk.com. Do not open a public issue for a vulnerability.

You can expect an initial response within a week.

## How credentials are handled

- Provider and LLM credentials are read from the environment or from a `.env` file passed with `--env-file`. They are never printed, logged or written to the run folder.
- The tool talks only to the homepage you check, your answer provider and, if you set a key, your LLM provider.
- The skill and the README pin the npm package to the major version (`ai-visibility-checker@0`), and releases are published only from the release workflow via trusted publishing.

## Hardening in place

- Domains are normalized; localhost, IP addresses and internal suffixes are refused as input.
- Before the homepage request and again after every redirect (at most three), the host name is resolved and refused if any of its addresses is private, loopback or link-local. The check runs on the DNS answer just before the request; a resolver that answers differently on the second lookup (DNS rebinding) is not ruled out. For a tool you run on your own machine against domains you choose, I consider that acceptable.
- Homepage reads have a 15 second timeout, and the download stops after 2 MB.
- The package has no runtime dependencies. CI uses SHA-pinned actions, least-privilege permissions, CodeQL and Dependabot. Releases are published via trusted publishing without long-lived tokens.

## Scope notes

The tool parses untrusted content: the homepage HTML and the answer text and sources returned by the engines. Crashes or corrupted reports on crafted input are in scope. Answer text is written into the Markdown report as returned, so treat reports from untrusted runs like any other untrusted Markdown.

The judge, whether your agent or an LLM called by the CLI, reads the answer texts as part of its prompt. An answer that contains instructions can try to steer the verdict. The tool checks every "named" verdict against the text, so a planted mention of your brand does not count, but the competitors and positions a judge reports are taken as given.
