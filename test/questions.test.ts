import { test } from "node:test";
import assert from "node:assert/strict";
import { checkQuestions, normalizeQuestion, parseQuestions } from "../src/core/questions.ts";

test("questions are read from text lists and JSON", () => {
  assert.deepEqual(parseQuestions("# my questions\n1. First one?\n- Second one?\n\n* Third?\n").questions, ["First one?", "Second one?", "Third?"]);
  assert.deepEqual(parseQuestions('["A?", "B?"]').questions, ["A?", "B?"]);
  assert.deepEqual(parseQuestions('{"brand": "Acme", "market": "de-DE", "questions": ["A?"]}'), { brand: "Acme", market: "de-DE", questions: ["A?"] });
});

test("a text list that starts like JSON is still a text list, and only strings count as questions", () => {
  assert.deepEqual(parseQuestions("[Draft] Which tool for plumbers?\nWhich software for invoices?").questions, ["[Draft] Which tool for plumbers?", "Which software for invoices?"]);
  assert.deepEqual(parseQuestions('[{"q": "x"}, "Real question?"]').questions, ["Real question?"]);
  assert.deepEqual(parseQuestions('{"questions": "not a list"}'), {});
});

test("questions are squashed to one line", () => {
  assert.equal(normalizeQuestion("  Which  tool\nfor plumbers\tworks best?  "), "Which tool for plumbers works best?");
});

test("broken question sets are errors, weak ones are warnings", () => {
  const good = Array.from({ length: 5 }, (_, i) => `Which accounting software works best for a small plumbing business number ${i}?`);
  assert.deepEqual(checkQuestions(good, "Acme", "acme.de"), { errors: [], warnings: [] });
  assert.match(checkQuestions([], "Acme", "acme.de").errors.join(), /no questions/);
  assert.match(checkQuestions([...good, good[0]!], "Acme", "acme.de").errors.join(), /duplicate/);
  assert.match(checkQuestions(Array(11).fill("x"), "Acme", "acme.de").errors.join(), /at most 10/);
  assert.match(checkQuestions(["x".repeat(301)], "Acme", "acme.de").errors.join(), /longer than 300/);
  const warned = checkQuestions(["Is Acme better than the others for plumbers in Germany?"], "Acme", "acme.de").warnings.join();
  assert.match(warned, /names the brand/);
  assert.match(warned, /1 question instead of 5/);
});
