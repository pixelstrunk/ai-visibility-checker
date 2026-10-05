# AI Visibility Checker

An Agent Skill (Claude Code, Codex and other agents) plus a command-line tool with the same core. It asks ChatGPT, Gemini and Google AI Mode five buyer questions for a website's market and writes a Markdown report: score per engine, competitors, the questions, every answer with its sources, and links to the hosted checker at christianstrunk.com.

## Stack

- Node 22 or newer at runtime, TypeScript 7 strict, ESM, no runtime dependencies. Erasable syntax only, so Node runs the sources and tests directly.
- Tests with `node:test`, run on the TypeScript sources. Node 22.18 or newer, or Node 24, runs them without a flag.
- Published to npm as `ai-visibility-checker`; the skill and the README pin `npx ai-visibility-checker@0`. See RELEASING.md for versions and releases.

## Layout

```
src/core/        homepage reading, markets, question checks, judging, report, shared rules
src/providers/   provider interface and DataForSEO
src/llm/         optional Anthropic or OpenAI step for the CLI
src/cli.ts       commands: check, prepare, ask, report, markets, providers
skills/ai-visibility-checker/SKILL.md
.claude-plugin/  Claude Code plugin and marketplace manifests
examples/example-report.md
```

The question rules and the judging rules live once in `src/core/rules.ts`. The CLI prints them for the agent and uses them for the LLM step; `SKILL.md` only summarizes them.

## Commands

- `npm run check` type check (sources and tests) and all tests
- `npm run build` compile to `dist/`
- `node bin/ai-visibility-checker.js <command>` run the local build
- A real run needs provider credentials in the environment or in a `.env` file passed with `--env-file`, and a `--dir` outside the repo.

## How We Work Here

- Plan first for anything larger than a small fix: describe the change, agree on it, then build.
- No comments in code, of any kind. Names and structure carry the meaning; the reasoning goes into the commit message or the docs.
- Every fix comes with a test. Tests run on the sources, with fakes for the network; recorded provider responses are stripped of anything account-related.
- Credentials are read at runtime only and never end up in code, fixtures, logs or chat.
- A real check costs money at the provider. Run one only when the task needs it, and say so beforehand.
- No browser automation. The person you work with opens and checks everything themselves.
- Versions must stay identical in `package.json`, `src/cli.ts` and `.claude-plugin/plugin.json`; CI fails if they drift.
- Every 0.x release reaches every installed skill on its next run, so the commands and the run folder format must not break within 0.x.
