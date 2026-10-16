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
- Before the homepage request and again after every redirect (at most three), the host name is resolved and refused if any of its addresses is private, loopback or link-local. The connection itself uses the same check on the address it actually connects to, so a resolver that answers differently on a second lookup (DNS rebinding) cannot reach an internal address.
- Homepage reads have a 15 second timeout, the download stops after 2 MB, and the HTML is parsed in linear time, so a crafted page cannot stall the tool.
- A questions file that looks like a credentials file (a `.env` name or `NAME=value` lines) is refused, and so is any question or brand that contains the value of a key, token, password or login from the environment. Error messages name a file that is not valid JSON, never its content.
- The package has no runtime dependencies. CI uses SHA-pinned actions, least-privilege permissions, CodeQL and Dependabot. Releases are published via trusted publishing without long-lived tokens.

## Scope notes

The tool parses untrusted content: the homepage HTML and the answer text and sources returned by the engines. Crashes or corrupted reports on crafted input are in scope. In the report, raw HTML in answers is escaped, images become plain links and unclosed code blocks are closed, so an answer cannot load anything or hide the rest of the report.

The agent and the judge read untrusted text. `prepare` prints the homepage last, between `<<<HOMEPAGE_TEXT` and `HOMEPAGE_TEXT>>>`, after its own instructions, and strips those markers from the page so a page cannot close the block early. `ask` and the skill tell the agent that answers are data, and the skill limits the agent to its own commands. The LLM judge gets the same instruction, and answer texts cannot close their own block in its prompt. The tool checks every "named" verdict against the text, so a planted mention of your brand does not count, but the competitors and positions a judge reports are taken as given.
