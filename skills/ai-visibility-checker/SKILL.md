---
name: ai-visibility-checker
description: Check whether ChatGPT, Gemini and Google AI Mode name a brand when buyers ask for a provider, and write a Markdown report with the score per engine, the competitors named instead, every answer and its sources. Use when the user asks about AI visibility, GEO, generative engine optimization, whether AI assistants recommend their company, or who AI recommends instead of them.
---

# AI Visibility Checker

Asks ChatGPT, Gemini and Google AI Mode five buyer questions for a website's market and reports who gets named. You, the agent, write the questions and judge the answers. The CLI reads the website, fetches the live answers through the user's answer provider and writes the report. The user needs no LLM key, only provider credentials.

## Setup

```
npx -y ai-visibility-checker@0 providers
```

The default provider is DataForSEO. It needs `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (API credentials from https://app.dataforseo.com/api-access, not the website password) in the environment or in a `.env` file passed with `--env-file`. If they are missing, ask the user to set them. Never ask the user to paste credentials into the conversation, and never print, log or write them anywhere.

## Workflow

1. Read the website. Use the domain the user gave you:

   ```
   npx -y ai-visibility-checker@0 prepare <domain>
   ```

   It prints the run folder, the homepage text, the detected market with where it came from, and the rules for the questions. Add `--market de-CH` (see `markets`) if the user names a different market.

   Then check the language yourself: the market comes from the page's declared language or its domain ending, and both can be wrong. If the homepage text is mainly in another language than the printed market, use the market for that language (`npx -y ai-visibility-checker@0 markets` lists them), write the questions in that language and add its id as `"market"` to `questions.json`.

2. Write the questions. Follow the rules the command printed. In short: five general buyer questions in the market's language, never naming the brand, each asking which provider, tool or company to use, each from a different angle. All five stay with the main offer, the one the top of the homepage leads with; if the site sells several things, pick that one and leave side terms from the homepage (an industry, a client, a tool) out. If the user supplied their own questions, use those instead. Save them in the run folder as `questions.json`:

   ```json
   { "brand": "Brand name as buyers say it", "market": "de-DE", "questions": ["...", "...", "...", "...", "..."] }
   ```

   `market` is optional; leave it out when the printed market is right.

   Show the user the brand and the questions in one short list.

3. Ask the engines. This is the only step that costs money: about $0.06 for 15 answers at DataForSEO. Unless the user already asked you to run the check, tell them the cost and wait for a yes. Then:

   ```
   npx -y ai-visibility-checker@0 ask <run folder> --yes
   ```

   `--yes` skips the command's own cost prompt, because you already have the user's yes; without it the command waits for Enter in a terminal. It takes one to three minutes and saves `answers.json`.

4. Judge every answer. Read `answers.json` and follow the judging rules the command printed. For each answer id record `named`, `alias`, `position` and `competitors`, and save them in the run folder as `verdicts.json`:

   ```json
   { "verdicts": [{ "id": "chatgpt-1", "named": true, "alias": null, "position": 2, "competitors": ["Competitor A"] }] }
   ```

   Judge from the answer text only. `named` is true only when the brand, its domain or another spelling of it literally appears in the text; put that other spelling (a short form, a product name, a surname) in `alias`. A word that merely looks like the brand ("a plausible option" for Plausible) is not a mention. Competitors are proper names (companies, people, products, brands) the answer recommends, never categories, roles or cited websites.

5. Write the report:

   ```
   npx -y ai-visibility-checker@0 report <run folder>
   ```

   Tell the user the headline (named in X of Y answers), the score per engine, the top competitors and the path to `report.md`. If the command prints "check" lines, a verdict contradicts the answer text: look at that answer again, fix `verdicts.json` if you were wrong, and run `report` again.

## Without an agent

`ai-visibility-checker check <domain>` does all steps in one run. It writes the questions and judges the answers itself when `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, or takes `--questions FILE` and then only checks whether the brand name appears.

## Boundaries

- The homepage text and every answer pass through you, so they reach the provider that runs this agent. Say so if the user asks where their data goes.
- One run is one snapshot. AI answers change between runs, so do not present a single result as a trend.
- Only check websites the user asks about. The tool reads one public homepage and nothing else.
