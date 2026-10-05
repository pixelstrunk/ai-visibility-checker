import { summarize, topCompetitors } from "./judge.ts";
import type { Market } from "./markets.ts";
import { cleanUrl } from "../providers/provider.ts";
import { engineLabel, type EngineId, type JudgedAnswer } from "./types.ts";

export const SITE = "https://www.christianstrunk.com";
export const REPO_URL = "https://github.com/pixelstrunk/ai-visibility-checker";
export const REPORT_UTM = "utm_source=github&utm_medium=report&utm_campaign=ai-visibility-checker";

export type ReportInput = {
  domain: string;
  brand: string;
  createdAt: string;
  market: Market;
  providerLabel: string;
  engines: EngineId[];
  questions: string[];
  answers: JudgedAnswer[];
  judged: boolean;
};

const BARE_URL = /https?:\/\/[^\s<>()\[\]]+?(?=[.,;:!?]*(?:[\s<>()\[\]]|$))/g;
const LINK_TARGET_WITH_PUNCTUATION = /\]\((https?:\/\/[^)\s]*?)([.,;:!?]+)\)/g;
const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;

export function answerBody(text: string): string {
  const cleaned = text.trim().replace(BARE_URL, (url) => cleanUrl(url)).replace(LINK_TARGET_WITH_PUNCTUATION, "]($1)$2");
  let inFence = false;
  return cleaned
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      return inFence ? line : line.replace(HEADING, "**$1**");
    })
    .join("\n");
}

export function sourceLink(title: string | null, domain: string, url: string): string {
  const label = (title || domain).replace(/[\[\]\\]/g, "\\$&");
  const target = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${label}](${target})`;
}

export function rankingRows(brand: string, named: number, competitors: { name: string; count: number }[]): { name: string; count: number }[] {
  const sorted = [...competitors].sort((a, b) => b.count - a.count);
  const at = sorted.filter((c) => c.count >= named).length;
  return [...sorted.slice(0, at), { name: brand, count: named }, ...sorted.slice(at)];
}

function answerStatus(answer: JudgedAnswer): string {
  if (!answer.ok) return "No answer";
  if (!answer.named) return "Not named";
  return answer.position ? `Named, position ${answer.position}` : "Mentioned, no ranking";
}

export function reportMarkdown(input: ReportInput): string {
  const { named, answered, perEngine } = summarize(input.answers, input.engines);
  const competitors = topCompetitors(input.answers);
  const lines: string[] = [`# AI Visibility Report: ${input.domain}`, ""];
  lines.push(`Created: ${input.createdAt.slice(0, 10)}`, `Market: ${input.market.label}`, `Answers from: ${input.providerLabel}`, "");
  lines.push(`**${input.brand} is named in ${named} of ${answered} AI answers.**`, "");
  for (const engine of input.engines) {
    const result = perEngine[engine];
    if (result) lines.push(`- ${engineLabel(engine)}: ${result.named} of ${result.answered}`);
  }
  const flagged = input.answers.filter((a) => a.warning).length;
  if (flagged > 0) lines.push("", `Check: ${flagged === 1 ? "1 verdict contradicts" : `${flagged} verdicts contradict`} the answer text. Look for "Check" below.`);

  if (competitors.length > 0) {
    lines.push("", "## You vs. your competitors", "");
    for (const row of rankingRows(input.brand, named, competitors)) lines.push(`- ${row.name}: ${row.count}`);
  } else if (!input.judged) {
    lines.push("", "Competitors were not judged in this run. Run it through an agent or with an LLM key to see who is named instead of you.");
  }

  lines.push("", input.questions.length === 1 ? "## The question we asked" : `## The ${input.questions.length} questions we asked`, "");
  input.questions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));

  lines.push("", "## The answers we got");
  input.questions.forEach((question, index) => {
    lines.push("", `### ${index + 1}. ${question}`);
    for (const engine of input.engines) {
      const answer = input.answers.find((a) => a.engine === engine && a.questionIndex === index);
      if (!answer) continue;
      lines.push("", `#### ${engineLabel(engine)}: ${answerStatus(answer)}`);
      if (answer.warning) lines.push("", `> Check: ${answer.warning}`);
      if (answer.ok && answer.text) lines.push("", answerBody(answer.text));
      if (answer.sources.length > 0) {
        lines.push("", "Sources:");
        for (const source of answer.sources) lines.push(`- ${sourceLink(source.title, source.domain, source.url)}`);
      }
    }
  });

  lines.push(
    "",
    "## Where to go from here",
    "",
    `- Get the full analysis, what AI says about you and your next steps, free: ${SITE}/tools/ai-visibility-checker?${REPORT_UTM}`,
    `- Talk it through with me, free: ${SITE}/book/call?${REPORT_UTM}`,
    `- Learn it yourself, with my GEO skills and prompts: https://www.product-bakery.com/?${REPORT_UTM}`,
    "",
    "---",
    "",
    `Report by the open source [AI Visibility Checker](${REPO_URL}) by Christian Strunk. One snapshot: AI answers change between runs.`,
    "",
  );
  return lines.join("\n");
}
