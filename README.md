# AI Visibility Checker

A free GEO (generative engine optimization) check: find out whether ChatGPT, Gemini and Google AI Mode name your brand when buyers ask for a provider, and who they recommend instead.

**[Try it without setup →](https://www.christianstrunk.com/tools/ai-visibility-checker?utm_source=github&utm_medium=readme&utm_campaign=ai-visibility-checker)** The hosted checker runs a deeper version of this check in your browser, with an analysis of what AI says about you and your next steps.

[![ci](https://github.com/pixelstrunk/ai-visibility-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/pixelstrunk/ai-visibility-checker/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ai-visibility-checker?cacheSeconds=3600)](https://www.npmjs.com/package/ai-visibility-checker)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Video walkthrough: coming soon.

AI Visibility Checker is an Agent Skill for Claude Code, Codex and other coding agents, plus a command-line tool with the same core. It reads your homepage, picks your market, asks the three engines five questions your buyers would ask, and writes a Markdown report: the score per engine, the competitors named instead of you, the questions, and every answer with its sources.

In the skill, your own agent writes the questions and judges the answers. You only need credentials for the answer provider. No Anthropic or OpenAI key, no account anywhere else.

## See it

```
$ ai-visibility-checker report ai-visibility/christianstrunk.com-2026-10-05
Christian Strunk is named in 3 of 15 AI answers.
  ChatGPT: 1 of 5
  Gemini: 0 of 5
  Google AI Mode: 2 of 5
Report: ai-visibility/christianstrunk.com-2026-10-05/report.md
```

The full report from this run is in [examples/example-report.md](examples/example-report.md). It starts like this:

```markdown
# AI Visibility Report: christianstrunk.com

Created: 2026-10-05
Market: United States, English
Answers from: DataForSEO

**Christian Strunk is named in 3 of 15 AI answers.**

- ChatGPT: 1 of 5
- Gemini: 0 of 5
- Google AI Mode: 2 of 5

## You vs. your competitors

- MentorCruise: 4
- ProductTrio: 3
- Reforge: 3
- Christian Strunk: 3
```

## Install the skill

| Agent | Install |
|---|---|
| Claude Code, Codex, Cursor and others | `npx skills add pixelstrunk/ai-visibility-checker` |
| Claude Code plugin | `/plugin marketplace add pixelstrunk/ai-visibility-checker`, then `/plugin install ai-visibility-checker@ai-visibility-checker` |
| By hand | copy `skills/ai-visibility-checker` into your agent's skills folder, for Claude Code `~/.claude/skills/` |

The skill runs the CLI through `npx ai-visibility-checker@0`, so Node 22 or newer is all it needs. It is pinned to the major version: updates within 0.x arrive on their own, a 1.0 with breaking changes does not.

Then ask your agent:

> Check the AI visibility of example.com

The agent reads your homepage, shows you the five questions it wrote, tells you what the check costs, asks the engines, judges every answer and hands you the report.

## Set up the answer provider

The default provider is [DataForSEO](https://dataforseo.com). It queries ChatGPT, Gemini and Google AI Mode the way people use them: the consumer apps with web search, in your market and language.

1. Create an account at dataforseo.com and add credit. A check costs about $0.06.
2. Copy your API login and API password from [API access](https://app.dataforseo.com/api-access). They are not your website password.
3. Put them in your environment, or in a `.env` file you pass with `--env-file`:

```
DATAFORSEO_LOGIN=you@example.com
DATAFORSEO_PASSWORD=your-api-password
```

Never paste the credentials into a chat with your agent. The tool reads them from the environment and never prints or stores them.

## Use the CLI

```
npx ai-visibility-checker@0 check example.com --questions my-questions.txt --brand "Example"
npx ai-visibility-checker@0 check example.com          # with ANTHROPIC_API_KEY or OPENAI_API_KEY set
npm install -g ai-visibility-checker@0                 # or install it once
```

`check` runs everything in one go and writes a run folder `ai-visibility/<domain>-<date>/` with `site.json`, `questions.json`, `answers.json`, `verdicts.json` and `report.md`. The `ai-visibility/` folder gets its own `.gitignore`, so runs inside a code project are never committed by accident. In a terminal, `check` and `ask` show the cost and wait for Enter before anything is paid; `--yes` skips that.

Without an agent, the CLI needs either your own questions or an LLM key:

- With `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, it writes the questions and judges the answers itself. That adds a few cents per check at your LLM provider. Choose one with `--llm anthropic|openai|none` and a model with `AVC_LLM_MODEL`.
- With `--questions FILE` and no LLM key, it asks your questions and checks whether your brand name appears in each answer. Positions and competitors need a judge, so they stay empty.

A questions file is one question per line, or JSON: `{ "brand": "Example", "questions": ["...", "..."] }`.

The agent runs the same thing in three steps, and so can you:

```
ai-visibility-checker prepare example.com     # read the homepage, pick the market, print the question rules
ai-visibility-checker ask <run folder>        # ask every engine, save answers.json, print the judging rules
ai-visibility-checker report <run folder>     # build report.md from answers.json and verdicts.json
```

| Option | What it does |
|---|---|
| `--questions FILE` | your own questions |
| `--brand NAME` | the name to look for in the answers |
| `--market ID` | force a market, for example `de-CH` or `en-GB` |
| `--engines LIST` | only some engines, for example `chatgpt,gemini` |
| `--provider ID` | answer provider, default `dataforseo` |
| `--llm NAME` | `anthropic`, `openai` or `none` for `check`, default: whichever key is set |
| `--verdicts FILE` | verdicts for `report`, default `verdicts.json` in the run folder |
| `--dir FOLDER` | where to write the run |
| `--env-file FILE` | load credentials from a `.env` file; its values win over the environment |
| `--yes` | skip the cost confirmation |

## Markets

The language your homepage declares picks the market, the top-level domain picks the country where a language is spoken in several. A page that declares no language gets its market from the domain ending (.de, .at, .ch, .fr, .es, .it, .nl, .be, .uk). Anything else falls back to the United States in English. With an LLM key, `check` also reads the language of the text itself and follows it when the declaration is wrong; in the skill, your agent does that check. `ai-visibility-checker markets` lists all 13:

United States, United Kingdom, Germany, Austria, Switzerland (German, French, Italian), France, Belgium (French, Dutch), Spain, Italy, Netherlands.

The questions are written in the market's language, and the engines answer as they would for a person in that country.

## Providers

A provider fetches the answers. The default is DataForSEO, which covers ChatGPT, Gemini and Google AI Mode. Run `ai-visibility-checker providers` to see what is available and configured.

Adding a provider is one file in `src/providers/` that implements the `Provider` type, plus one line to register it in `src/providers/index.ts`. There is no plugin mechanism yet, so a new provider means a change to the code and a new release. See [CONTRIBUTING.md](CONTRIBUTING.md).

One caution: the APIs of the models themselves (OpenAI, Gemini, Anthropic) answer differently from the apps your buyers use. The apps search the web, use the person's country and cite sources; a bare model call usually does none of that. A provider built on the model APIs measures something else than what your buyers see.

### Why not Claude or Perplexity

The checker only counts answers the way buyers see them: in the app, with web search, for their country, with sources.

For ChatGPT, Gemini and Google AI Mode the default provider returns exactly those answers, read from the apps. For Claude and Perplexity, DataForSEO offers answers through the model APIs only, not from the apps. Those calls can search the web and return citations, but they run a model and settings you pick, not the app your buyers open, and the two answer differently (see the caution above).

So they are left out rather than measured the wrong way. Perplexity comes in as soon as a provider returns its app answers. A provider for either one is a welcome contribution, see [CONTRIBUTING.md](CONTRIBUTING.md).

## What it measures, and what it does not

For each answer the report shows whether your brand is named, at which position among the recommended providers, which competitors are named, and which pages the engine cites as sources. The competitor ranking counts in how many answers each competitor appears.

The verdict of the judge (your agent or the LLM) decides whether an answer names you. The tool checks every verdict against the text: a "named" verdict without your name, domain or the alias the judge gives is not counted, and the report marks every verdict that contradicts the text with "Check". Without a judge, the tool looks for your brand name as you wrote it, with matching capitals, or your domain.

It is one snapshot. AI answers change between runs and between people, so treat one report as a sample, not a trend.

The hosted checker at christianstrunk.com goes further: it asks six questions along the buyer's journey instead of the five of this check, tells you whether AI describes your company correctly and gives you five next steps from what the answers and their sources show. That part is not in this repo.

## Privacy

What leaves your machine, and where it goes:

- **The homepage you check** is read once. If the site blocks the checker, the tool reads it a second time with the user agent of a regular Chrome browser. Only the homepage is read, nothing else on the site.
- **Your questions** go to your answer provider (DataForSEO by default), together with the market.
- **With an LLM key in the CLI**, the homepage text goes to Anthropic or OpenAI to write the questions, and all answers go there to be judged.
- **In the skill**, your agent reads the homepage text and all answers, so they reach the provider that runs your agent.

Nothing is sent to me. Run folders stay on your disk.

## Where to go from here

- Get the full analysis and your next steps, free: [AI Visibility Checker](https://www.christianstrunk.com/tools/ai-visibility-checker?utm_source=github&utm_medium=readme&utm_campaign=ai-visibility-checker)
- Talk it through with me, free: [Book a call](https://www.christianstrunk.com/book/call?utm_source=github&utm_medium=readme&utm_campaign=ai-visibility-checker)
- Learn it yourself, with my GEO skills and prompts: [The Product Bakery](https://www.product-bakery.com/?utm_source=github&utm_medium=readme&utm_campaign=ai-visibility-checker)

## Contributing

Bug reports, new providers and new markets are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE](LICENSE).
