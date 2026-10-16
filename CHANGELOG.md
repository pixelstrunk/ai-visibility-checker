# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-10-16

### Security

- `prepare` prints the homepage text last, fenced as data between `<<<HOMEPAGE_TEXT` and `HOMEPAGE_TEXT>>>`; `ask`, the skill and the LLM prompts say that page and answer texts are data, never instructions.
- A questions file that looks like a credentials file, or a question or brand that contains a credential from the environment, is refused before anything is sent.
- A file that is not valid JSON is named in the error, its content is never shown.
- The homepage connection checks the address it actually connects to, which closes DNS rebinding. 6to4 and IPv4-compatible IPv6 addresses count as private.
- Raw HTML in answers is escaped in the report and images become plain links.

### Fixed

- Ordinary pages behind Cloudflare, and pages whose scripts contain "access denied", are no longer mistaken for bot challenges.
- Custom elements such as `<svg-icon>` or `<title-bar>` no longer swallow the homepage text after them.
- Named entities such as `&uuml;`, `&eacute;`, `&ndash;` and `&euro;` are decoded.
- Broken HTML near the 2 MB limit is parsed in linear time.
- A region in the declared language (`en-GB`, `de-AT`, `fr-BE`) picks the country on .com and other neutral domain endings; `data-lang` and `lang="english"` are no longer misread.
- A link that only cites the brand's website as a source no longer counts as a mention, with or without a judge.
- A brand written in lower case is matched with any capitals when there is no judge.
- Domains match whole hosts only (`acme.com` no longer matches `acme.com.au`), and an international domain also matches its punycode form.
- A brand is no longer found inside a different product written like a domain (`Bolt` in `Bolt.new`), and competitors that only share a word with the brand are kept.
- Competitor spellings that form a chain (`Zoom`, `Zoom Video`, `Zoom Video Communications`) merge into the longest one.
- Verdicts with the wrong type (`"named": "true"`, `"position": "2"`) are refused with a clear error instead of being counted as not named, and an alias that is an ordinary lower case word is ignored.
- `prepare` on an earlier run folder removes its answers, verdicts and report, and its questions when the domain changes.
- `check` asks once before anything is paid, the LLM step included.
- Unclosed code blocks, setext underlines and HTML comments in answers no longer break the rest of the report, and links in answers keep their `#section` anchors.
- Printed next-step commands quote run folders that contain spaces.

## [0.1.1] - 2026-10-16

### Changed

- "Customer" instead of "buyer" in the question rules, the CLI help, the skill, the README and the package description.

## [0.1.0] - 2026-10-05

### Added

- Agent Skill (`skills/ai-visibility-checker`) for Claude Code, Codex and other agents: the agent writes the five customer questions and judges the answers, the CLI reads the homepage, fetches the answers and writes the report. No LLM key needed.
- Claude Code plugin manifest, installable with `/plugin marketplace add pixelstrunk/ai-visibility-checker`.
- CLI with `check`, `prepare`, `ask`, `report`, `markets` and `providers`.
- DataForSEO provider for ChatGPT, Gemini and Google AI Mode, behind an exchangeable provider interface.
- 13 markets, picked from the homepage language and the top-level domain, with United States English as the fallback.
- Markdown report in the layout of the hosted checker: score per engine, competitors, questions, every answer with its sources.
- Optional LLM step for the CLI with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, using structured JSON output on both.
- The judge's verdict decides whether an answer names the brand; a "named" verdict needs the brand, its domain or the judge's alias in the text, and every contradiction between verdict and text is marked "Check" in the report.
- Market from the domain ending when the page declares no language, and from the language of the text when an LLM writes the questions.
- Cost confirmation in the terminal before `check` and `ask` pay for answers (`--yes` skips it), and a `.gitignore` in the `ai-visibility/` runs folder.
- The homepage read checks the resolved address before every request and after every redirect, stops after 2 MB and honours the page's declared charset.
- `--env-file` values win over the environment; `report --verdicts FILE` refuses a missing file; `answers.json` is validated field by field before a report is written.
- `--dir` only clears a folder that holds an earlier run (`site.json`); any other folder with files in it is refused, so `--dir .` never deletes your own files.
- Brands with one or two characters (EY, 3M, O2) are found as whole words with exact capitals instead of being skipped.
- The skill runs `ask` with `--yes`, because the agent has already asked the user; without it the command waits for Enter in a terminal.
- The report footer links back to the repository.
- LLM calls are retried once on 429 and 5xx answers (529 included), never after a timeout.
- The release workflow stops when the tag does not match the version in `package.json`, and pins npm to a version with trusted publishing.
- A page whose language has no market of its own (for example `lang="pl"`) gets a warning in `prepare` and `check` that the check runs for the United States in English, with a pointer to `--market`.
