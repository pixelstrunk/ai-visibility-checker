import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseEnv } from "node:util";
import { parseAnswersFile } from "./core/answers.ts";
import { askAll, estimateCostUsd } from "./core/ask.ts";
import { InputError, normalizeDomain } from "./core/domain.ts";
import { fetchPage, readHomepage, type PageFetcher } from "./core/homepage.ts";
import { judgeAnswers, missingVerdicts, parseVerdicts, summarize } from "./core/judge.ts";
import { chooseMarket, hasMarket, marketFromDomain, marketId, marketRows, parseMarket, type Market } from "./core/markets.ts";
import { checkQuestions, normalizeQuestion, parseQuestions } from "./core/questions.ts";
import { reportMarkdown } from "./core/report.ts";
import { JUDGE_RULES, marketLanguage, questionRules } from "./core/rules.ts";
import { engineLabel, type AnswersFile, type QuestionsFile, type SiteFile, type Verdict } from "./core/types.ts";
import { llmFromEnv, type LlmPair } from "./llm/llm.ts";
import { judgeWithLlm, writeQuestions } from "./llm/tasks.ts";
import { DEFAULT_PROVIDER, PROVIDERS, type Provider } from "./providers/index.ts";

export const VERSION = "0.1.0";

export const FILES = { site: "site.json", questions: "questions.json", answers: "answers.json", verdicts: "verdicts.json", report: "report.md" } as const;
export const RUNS_FOLDER = "ai-visibility";

const HELP = `ai-visibility-checker ${VERSION}

Asks ChatGPT, Gemini and Google AI Mode the questions your buyers ask and
writes a Markdown report: who gets named, at which position, with sources.

One command:
  ai-visibility-checker check <domain> [--questions FILE] [--brand NAME]

Step by step (how agents run it):
  ai-visibility-checker prepare <domain>    read the homepage, pick the market
  ai-visibility-checker ask <folder>        ask every engine, save the answers
  ai-visibility-checker report <folder>     write report.md

Other:
  ai-visibility-checker markets             list the 13 markets
  ai-visibility-checker providers           list the answer providers

Options:
  --questions FILE   your own questions (one per line, or JSON)
  --brand NAME       the brand name to look for in the answers
  --market ID        force a market, for example de-DE or en-GB
  --provider ID      answer provider (default: ${DEFAULT_PROVIDER})
  --engines LIST     comma separated, for example chatgpt,gemini
  --llm NAME         anthropic, openai or none (check only, default: auto)
  --verdicts FILE    verdicts for report (default: <folder>/verdicts.json)
  --dir FOLDER       where to write the run (default: ./${RUNS_FOLDER}/<domain>-<date>)
  --env-file FILE    load keys from a .env file; its values win over the environment
  --yes              skip the cost confirmation

Keys:
  DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD   required for the default provider
  ANTHROPIC_API_KEY or OPENAI_API_KEY     optional, lets "check" write the
                                          questions and judge the answers
`;

export type Context = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  out(text?: string): void;
  note(text: string): void;
  fetchPage: PageFetcher;
  providers: Provider[];
  llm: LlmPair | null | undefined;
  interactive: boolean;
  confirm(question: string): Promise<boolean>;
  now(): Date;
};

async function confirmInTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function defaultContext(): Context {
  return {
    env: process.env,
    cwd: process.cwd(),
    out: (text = "") => process.stdout.write(`${text}\n`),
    note: (text) => process.stderr.write(`${text}\n`),
    fetchPage,
    providers: PROVIDERS,
    llm: undefined,
    interactive: Boolean(process.stdin.isTTY),
    confirm: confirmInTerminal,
    now: () => new Date(),
  };
}

type Args = { command: string; positional: string[]; flags: Record<string, string | true> };

const VALUE_FLAGS = new Set(["questions", "brand", "market", "provider", "engines", "llm", "dir", "env-file", "verdicts"]);
const SWITCH_FLAGS = new Set(["help", "version", "yes"]);
const SHORT_FLAGS: Record<string, string> = { "-h": "help", "-v": "version", "-y": "yes" };

class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const short = SHORT_FLAGS[arg];
    if (short) flags[short] = true;
    else if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (SWITCH_FLAGS.has(name)) {
        if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
        flags[name] = true;
      } else if (VALUE_FLAGS.has(name)) {
        const value = inline ?? argv[++i];
        if (value === undefined || value === "" || value.startsWith("-")) throw new UsageError(`--${name} needs a value`);
        flags[name] = value;
      } else throw new UsageError(`unknown option --${name}`);
    } else positional.push(arg);
  }
  return { command: positional.shift() ?? "", positional, flags };
}

function flag(args: Args, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    throw new InputError(`could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const RUN_OUTPUTS = [FILES.answers, FILES.verdicts, FILES.report];

function newRunDir(ctx: Context, domain: string, wanted: string | undefined, clearEarlierRun = false): string {
  if (wanted) {
    const dir = resolve(ctx.cwd, wanted);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      return dir;
    }
    const earlierRun = existsSync(join(dir, FILES.site));
    if (!earlierRun && readdirSync(dir).length > 0) throw new InputError(`${dir} is not empty and not an earlier run; use an empty folder or a run folder with ${FILES.site}`);
    if (earlierRun && clearEarlierRun) for (const name of RUN_OUTPUTS) rmSync(join(dir, name), { force: true });
    return dir;
  }
  const runs = resolve(ctx.cwd, RUNS_FOLDER);
  mkdirSync(runs, { recursive: true });
  const ignore = join(runs, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  const base = join(runs, `${domain}-${ctx.now().toISOString().slice(0, 10)}`);
  let dir = base;
  for (let n = 2; existsSync(dir); n += 1) dir = `${base}-${n}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function requireDomain(input: string | undefined): string {
  const domain = normalizeDomain(input);
  if (!domain) throw new UsageError(input ? `"${input}" is not a public domain` : "missing domain, for example: ai-visibility-checker check example.com");
  return domain;
}

function forcedMarket(args: Args): Market | null {
  const wanted = flag(args, "market");
  if (!wanted) return null;
  const market = parseMarket(wanted);
  if (!market) throw new UsageError(`unknown market "${wanted}", see: ai-visibility-checker markets`);
  return market;
}

function pickProvider(ctx: Context, args: Args): Provider {
  const id = flag(args, "provider") ?? ctx.env.AVC_PROVIDER ?? DEFAULT_PROVIDER;
  const provider = ctx.providers.find((p) => p.id === id);
  if (!provider) throw new UsageError(`unknown provider "${id}", see: ai-visibility-checker providers`);
  const missing = provider.missingSetup(ctx.env);
  if (missing) throw new InputError(`${missing} ${provider.setup}`);
  return provider;
}

function pickEngines(args: Args, provider: Provider): string[] {
  const wanted = flag(args, "engines");
  if (!wanted) return provider.engines;
  const engines = wanted.split(",").map((e) => e.trim()).filter(Boolean);
  const unknown = engines.filter((e) => !provider.engines.includes(e));
  if (unknown.length) throw new UsageError(`${provider.label} does not support ${unknown.join(", ")}; it supports ${provider.engines.join(", ")}`);
  return engines;
}

function marketSource(forced: Market | null, language: string | null, domain: string): string {
  if (forced) return "set with --market";
  if (language && !hasMarket(language)) return `fallback, the page declares lang="${language}" which has no market of its own`;
  if (language) return `from the page's lang="${language}"`;
  return marketFromDomain(domain) ? "from the domain ending, the page declares no language" : "fallback, the page declares no language";
}

async function prepareSite(ctx: Context, domain: string, args: Args, dir: string): Promise<{ site: SiteFile; source: string }> {
  ctx.note(`Reading https://${domain}/ ...`);
  const page = await readHomepage(domain, ctx.fetchPage);
  if (page.identity === "browser") ctx.note("The homepage blocked the checker, so it was read a second time with a browser user agent.");
  const forced = forcedMarket(args);
  const market = forced ?? chooseMarket(page.language, domain);
  if (!forced && page.language && !hasMarket(page.language)) {
    ctx.note(`warning: the page declares lang="${page.language}", a language without a market of its own, so the check runs for ${market.label}. Pass --market to pick one of the 13 markets instead.`);
  }
  const site: SiteFile = { domain, url: page.url, title: page.title, description: page.description, text: page.text, language: page.language, market, readAt: ctx.now().toISOString() };
  writeJson(join(dir, FILES.site), site);
  return { site, source: marketSource(forced, page.language, domain) };
}

function loadQuestions(path: string): Partial<QuestionsFile> {
  if (!existsSync(path)) throw new InputError(`${path} does not exist`);
  try {
    return parseQuestions(readFileSync(path, "utf8"));
  } catch (err) {
    throw new InputError(`could not read ${path}: ${message(err)}`);
  }
}

function validated(ctx: Context, file: Partial<QuestionsFile>, domain: string): QuestionsFile {
  const brand = (file.brand ?? "").trim();
  if (!brand) throw new InputError('the brand is missing; add "brand" to questions.json or pass --brand');
  const questions = (file.questions ?? []).map(normalizeQuestion).filter(Boolean);
  const check = checkQuestions(questions, brand, domain);
  for (const warning of check.warnings) ctx.note(`warning: ${warning}`);
  if (check.errors.length) throw new InputError(`questions: ${check.errors.join("; ")}`);
  if (file.market && !parseMarket(file.market)) throw new InputError(`unknown market "${file.market}" in the questions, see: ai-visibility-checker markets`);
  return { brand, questions, ...(file.market ? { market: file.market } : {}) };
}

async function runAsk(ctx: Context, dir: string, site: SiteFile, questions: QuestionsFile, args: Args): Promise<AnswersFile> {
  const provider = pickProvider(ctx, args);
  const engines = pickEngines(args, provider);
  const market = forcedMarket(args) ?? (questions.market ? parseMarket(questions.market) : null) ?? site.market;
  const count = questions.questions.length;
  const total = count * engines.length;
  const estimate = estimateCostUsd(provider, count, engines.length).toFixed(3);
  ctx.note(`Asking ${engines.map(engineLabel).join(", ")} ${count} ${count === 1 ? "question" : "questions"} each in ${market.label}: ${total} ${total === 1 ? "answer" : "answers"}, about $${estimate} at ${provider.label}.`);
  if (ctx.interactive && !args.flags.yes && !(await ctx.confirm("Continue and pay for these answers? [Y/n] "))) {
    throw new InputError("cancelled, nothing was asked or charged");
  }
  const answers = await askAll({
    provider,
    engines,
    questions: questions.questions,
    market,
    env: ctx.env,
    onAnswer: (a, done, all) => ctx.note(`  [${done}/${all}] ${engineLabel(a.engine)}, question ${a.questionIndex + 1}: ${a.ok ? "answered" : `failed (${a.error})`}`),
  });
  const costUsd = Math.round(answers.reduce((sum, a) => sum + a.costUsd, 0) * 10000) / 10000;
  const file: AnswersFile = { domain: site.domain, brand: questions.brand, market, provider: provider.id, engines, createdAt: ctx.now().toISOString(), questions: questions.questions, answers, costUsd };
  for (const name of [FILES.verdicts, FILES.report]) rmSync(join(dir, name), { force: true });
  writeJson(join(dir, FILES.answers), file);
  const failed = answers.filter((a) => !a.ok).length;
  ctx.note(`${total - failed} of ${total} answers received, cost $${costUsd.toFixed(3)}.`);
  if (failed === total) throw new InputError(`no engine answered. First error: ${answers[0]?.error ?? "unknown"}`);
  return file;
}

function writeReport(ctx: Context, dir: string, answers: AnswersFile, verdicts: Verdict[] | null): string {
  const provider = ctx.providers.find((p) => p.id === answers.provider);
  const judged = judgeAnswers(answers.answers, verdicts, answers.brand, answers.domain);
  const markdown = reportMarkdown({
    domain: answers.domain,
    brand: answers.brand,
    createdAt: answers.createdAt,
    market: answers.market,
    providerLabel: provider?.label ?? answers.provider,
    engines: answers.engines,
    questions: answers.questions,
    answers: judged,
    judged: verdicts !== null,
  });
  const path = join(dir, FILES.report);
  writeFileSync(path, markdown);
  const summary = summarize(judged, answers.engines);
  ctx.out(`${answers.brand} is named in ${summary.named} of ${summary.answered} AI answers.`);
  for (const engine of answers.engines) {
    const e = summary.perEngine[engine];
    if (e) ctx.out(`  ${engineLabel(engine)}: ${e.named} of ${e.answered}`);
  }
  for (const answer of judged) if (answer.warning) ctx.note(`check ${answer.id}: ${answer.warning}`);
  ctx.out(`Report: ${path}`);
  return path;
}

async function cmdPrepare(ctx: Context, args: Args): Promise<number> {
  const domain = requireDomain(args.positional[0]);
  const dir = newRunDir(ctx, domain, flag(args, "dir"));
  const { site, source } = await prepareSite(ctx, domain, args, dir);
  ctx.out(`Run folder: ${dir}`);
  ctx.out(`Site: ${site.url}`);
  ctx.out(`Title: ${site.title}`);
  if (site.description) ctx.out(`Description: ${site.description}`);
  ctx.out(`Market: ${site.market.label} (${marketId(site.market)}), ${source}`);
  ctx.out("");
  ctx.out("Homepage text:");
  ctx.out(site.text);
  ctx.out("");
  ctx.out(`Check the language first: is the homepage text above mainly in ${marketLanguage(site.market)}? If it is in another language, use the market for that language (see: ai-visibility-checker markets), write the questions in that language and add "market": "<id>" to questions.json.`);
  ctx.out("");
  ctx.out("Next step: write the questions.");
  ctx.out("");
  ctx.out(questionRules(site.market));
  ctx.out("");
  ctx.out(`Save them as ${join(dir, FILES.questions)}:`);
  ctx.out(JSON.stringify({ brand: "Brand name as buyers say it", questions: ["...", "...", "...", "...", "..."] }, null, 2));
  ctx.out("");
  ctx.out(`Then run: ai-visibility-checker ask ${dir}`);
  return 0;
}

function loadRun(ctx: Context, dir: string | undefined): { dir: string; site: SiteFile } {
  if (!dir) throw new UsageError("missing run folder, the one prepare printed");
  const path = resolve(ctx.cwd, dir);
  if (!existsSync(join(path, FILES.site))) throw new InputError(`${path} has no ${FILES.site}; run prepare first`);
  return { dir: path, site: readJson<SiteFile>(join(path, FILES.site)) };
}

async function cmdAsk(ctx: Context, args: Args): Promise<number> {
  const { dir, site } = loadRun(ctx, args.positional[0]);
  const source = flag(args, "questions") ? resolve(ctx.cwd, flag(args, "questions")!) : join(dir, FILES.questions);
  const raw = loadQuestions(source);
  const brand = flag(args, "brand");
  const questions = validated(ctx, { ...raw, ...(brand ? { brand } : {}) }, site.domain);
  writeJson(join(dir, FILES.questions), questions);
  const answers = await runAsk(ctx, dir, site, questions, args);
  ctx.out(`Answers: ${join(dir, FILES.answers)}`);
  ctx.out("");
  ctx.out(`Next step: judge each answer in ${FILES.answers} for the brand "${answers.brand}" (domain ${answers.domain}).`);
  ctx.out("");
  ctx.out(JUDGE_RULES);
  ctx.out("");
  ctx.out(`Save the verdicts as ${join(dir, FILES.verdicts)}, one entry per answer id:`);
  ctx.out(JSON.stringify({ verdicts: [{ id: answers.answers.find((a) => a.ok)?.id ?? "chatgpt-1", named: true, alias: null, position: 2, competitors: ["Competitor A", "Competitor B"] }] }, null, 2));
  ctx.out("");
  ctx.out(`Answer ids: ${answers.answers.filter((a) => a.ok).map((a) => a.id).join(", ")}`);
  ctx.out("");
  ctx.out(`Then run: ai-visibility-checker report ${dir}`);
  return 0;
}

async function cmdReport(ctx: Context, args: Args): Promise<number> {
  if (!args.positional[0]) throw new UsageError("missing run folder");
  const dir = resolve(ctx.cwd, args.positional[0]);
  const answersPath = join(dir, FILES.answers);
  if (!existsSync(answersPath)) throw new InputError(`${dir} has no ${FILES.answers}; run ask first`);
  let answers: AnswersFile;
  try {
    answers = parseAnswersFile(readJson<unknown>(answersPath));
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError(`${answersPath} is incomplete (${message(err)}); run ask again`);
  }
  const wantedVerdicts = flag(args, "verdicts");
  const verdictPath = wantedVerdicts ? resolve(ctx.cwd, wantedVerdicts) : join(dir, FILES.verdicts);
  if (wantedVerdicts && !existsSync(verdictPath)) throw new InputError(`${verdictPath} does not exist`);
  let verdicts: Verdict[] | null = null;
  if (existsSync(verdictPath)) {
    try {
      verdicts = parseVerdicts(readJson<unknown>(verdictPath));
    } catch (err) {
      throw new InputError(`${verdictPath}: ${message(err)}`);
    }
    const missing = missingVerdicts(answers.answers, verdicts);
    if (missing.length) ctx.note(`warning: no verdict for ${missing.join(", ")}; those answers are only checked for the brand name`);
  } else ctx.note(`No ${FILES.verdicts} found: the report only checks whether the brand name appears, without positions or competitors.`);
  writeReport(ctx, dir, answers, verdicts);
  return 0;
}

async function cmdCheck(ctx: Context, args: Args): Promise<number> {
  const domain = requireDomain(args.positional[0]);
  const forced = forcedMarket(args);
  pickEngines(args, pickProvider(ctx, args));
  const questionsPath = flag(args, "questions");
  const llm = ctx.llm !== undefined ? ctx.llm : llmFromEnv(flag(args, "llm"), ctx.env);
  if (!questionsPath && !llm) {
    throw new InputError("no questions: pass --questions FILE, or set ANTHROPIC_API_KEY or OPENAI_API_KEY so the questions can be written for you. In Claude Code, Codex and other agents, use the skill instead: the agent writes the questions.");
  }
  const file: Partial<QuestionsFile> = questionsPath ? loadQuestions(resolve(ctx.cwd, questionsPath)) : {};
  const brandFlag = flag(args, "brand");
  if (brandFlag) file.brand = brandFlag;
  let questions: QuestionsFile | null = llm ? null : validated(ctx, file, domain);
  const dir = newRunDir(ctx, domain, flag(args, "dir"), true);
  const { site, source } = await prepareSite(ctx, domain, args, dir);
  ctx.note(`Market: ${site.market.label}, ${source}`);
  let llmCost = 0;
  const needQuestions = !file.questions || file.questions.length === 0;
  if ((needQuestions || !file.brand) && llm) {
    ctx.note(needQuestions ? `Writing questions with ${llm.questions.model} ...` : `Reading the brand name with ${llm.questions.model} ...`);
    const written = await writeQuestions(llm.questions, site, forced);
    llmCost += written.costUsd ?? 0;
    if (needQuestions) {
      file.questions = written.questions;
      if (marketId(written.market) !== marketId(site.market)) {
        ctx.note(`The homepage text is in "${written.language}", so the market is ${written.market.label} instead of ${site.market.label}.`);
        site.market = written.market;
        writeJson(join(dir, FILES.site), site);
      }
      file.market = marketId(written.market);
    }
    file.brand ??= written.brand;
  }
  questions ??= validated(ctx, file, domain);
  writeJson(join(dir, FILES.questions), questions);
  questions.questions.forEach((q, i) => ctx.note(`  ${i + 1}. ${q}`));
  const answers = await runAsk(ctx, dir, site, questions, args);
  let verdicts: Verdict[] | null = null;
  if (llm) {
    ctx.note(`Judging answers with ${llm.judge.model} ...`);
    try {
      const judged = await judgeWithLlm(llm.judge, answers.brand, domain, answers.answers);
      verdicts = parseVerdicts(judged.verdicts);
      const missing = missingVerdicts(answers.answers, verdicts);
      if (missing.length) ctx.note(`warning: no verdict for ${missing.join(", ")}; those answers are only checked for the brand name`);
      llmCost += judged.costUsd ?? 0;
      writeJson(join(dir, FILES.verdicts), { verdicts });
    } catch (err) {
      ctx.note(`warning: judging failed (${message(err)}); the report only checks for the brand name`);
    }
    if (llmCost > 0) ctx.note(`LLM cost: about $${llmCost.toFixed(3)}`);
  }
  writeReport(ctx, dir, answers, verdicts);
  return 0;
}

function cmdMarkets(ctx: Context): number {
  for (const market of marketRows()) ctx.out(`${marketId(market).padEnd(6)} ${market.label}`);
  ctx.out("");
  ctx.out("The homepage language picks the market. Without a declared language the domain ending decides, anything else falls back to en-US.");
  return 0;
}

function cmdProviders(ctx: Context): number {
  for (const provider of ctx.providers) {
    const missing = provider.missingSetup(ctx.env);
    ctx.out(`${provider.id}${provider.id === DEFAULT_PROVIDER ? " (default)" : ""}: ${provider.engines.map(engineLabel).join(", ")}`);
    ctx.out(`  ${missing ? `${missing} ${provider.setup}` : "configured"}`);
  }
  return 0;
}

export async function main(argv: string[], overrides: Partial<Context> = {}): Promise<number> {
  const ctx: Context = { ...defaultContext(), ...overrides };
  try {
    const args = parseArgs(argv);
    if (args.flags.version) {
      ctx.out(VERSION);
      return 0;
    }
    if (args.flags.help || !args.command || args.command === "help") {
      ctx.out(HELP);
      return args.command || args.flags.help ? 0 : 2;
    }
    const envFile = flag(args, "env-file");
    if (envFile) {
      const path = resolve(ctx.cwd, envFile);
      if (!existsSync(path)) throw new InputError(`${envFile} does not exist`);
      Object.assign(ctx.env, parseEnv(readFileSync(path, "utf8")));
    }
    switch (args.command) {
      case "check":
        return await cmdCheck(ctx, args);
      case "prepare":
        return await cmdPrepare(ctx, args);
      case "ask":
        return await cmdAsk(ctx, args);
      case "report":
        return await cmdReport(ctx, args);
      case "markets":
        return cmdMarkets(ctx);
      case "providers":
        return cmdProviders(ctx);
      default:
        throw new UsageError(`unknown command "${args.command}"`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      ctx.note(`error: ${err.message}\nRun ai-visibility-checker --help for usage.`);
      return 2;
    }
    ctx.note(`error: ${message(err)}`);
    return 1;
  }
}
