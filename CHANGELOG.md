# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - unreleased

### Added

- Agent Skill (`skills/ai-visibility-checker`) for Claude Code, Codex and other agents: the agent writes the five buyer questions and judges the answers, the CLI reads the homepage, fetches the answers and writes the report. No LLM key needed.
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
