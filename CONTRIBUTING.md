# Contributing

Thanks for helping. This project is small on purpose, and contributions that keep it small are the most welcome kind. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Dev setup

```
git clone https://github.com/pixelstrunk/ai-visibility-checker
cd ai-visibility-checker
npm install
npm run check        # type check and all tests
npm run build
node bin/ai-visibility-checker.js --help
```

Node 24, or Node 22.18 or newer, runs the TypeScript tests directly; older Node 22 releases need `--experimental-strip-types`. The published package runs on Node 22 or newer and has no runtime dependencies. `npm run check` type checks the sources and the tests and runs every test.

## Adding a provider

A provider fetches the answers of one or more engines. It is one file in `src/providers/` that exports a `Provider`:

- `id`, `label` and the `engines` it covers (`chatgpt`, `gemini`, `ai_mode`, or new ones such as `perplexity`)
- `costPerAnswerUsd`, used for the cost note before a run
- `setup` and `missingSetup(env)`, which name the environment variables it needs
- `ask(engine, question, market, env)`, which returns the answer text, the cited sources and the cost

Register it in `src/providers/index.ts` and add a test with a recorded response in `test/`. Strip everything account-related from recorded responses.

Prefer providers that capture what the consumer apps answer, with web search, country and sources. A provider that calls a model API directly measures something else; if you add one, say so in its `label`.

## Adding a market

Markets live in `src/core/markets.ts`. A market needs the language, the country, the DataForSEO location code and, where a language is spoken in several countries, the top-level domains that pick it. Add a line to `test/markets.test.ts`.

## Report layout

The report deliberately matches the hosted checker at christianstrunk.com. Changes to headings or order should keep the two in step; open an issue first.

## Scope

In scope: providers, markets, the CLI, the skill, the report. Out of scope: the analysis and next steps of the hosted checker, monitoring over time, and anything that needs a server.
