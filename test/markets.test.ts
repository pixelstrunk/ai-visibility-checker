import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseMarket, DEFAULT_MARKET, htmlLanguage, marketId, marketRows, parseMarket } from "../src/core/markets.ts";

test("there are 13 markets", () => {
  assert.equal(marketRows().length, 13);
});

test("the homepage language picks the market, the top level domain picks the country", () => {
  assert.equal(marketId(chooseMarket("de", "beispiel.de")), "de-DE");
  assert.equal(marketId(chooseMarket("de", "beispiel.at")), "de-AT");
  assert.equal(marketId(chooseMarket("de-CH", "beispiel.ch")), "de-CH");
  assert.equal(marketId(chooseMarket("fr", "exemple.ch")), "fr-CH");
  assert.equal(marketId(chooseMarket("fr", "exemple.be")), "fr-BE");
  assert.equal(marketId(chooseMarket("nl", "voorbeeld.be")), "nl-BE");
  assert.equal(marketId(chooseMarket("en", "example.co.uk")), "en-GB");
  assert.equal(marketId(chooseMarket("it", "esempio.com")), "it-IT");
  assert.equal(marketId(chooseMarket("es", "ejemplo.es")), "es-ES");
});

test("unknown or missing languages fall back to the United States", () => {
  assert.deepEqual(chooseMarket("pl", "przyklad.pl"), DEFAULT_MARKET);
  assert.deepEqual(chooseMarket(null, "example.com"), DEFAULT_MARKET);
  assert.equal(DEFAULT_MARKET.locationCode, 2840);
});

test("markets can be forced by id", () => {
  assert.equal(parseMarket("de-CH")?.label, "Switzerland, German");
  assert.equal(parseMarket("EN_gb")?.country, "GB");
  assert.equal(parseMarket("pl-PL"), null);
  assert.equal(parseMarket("germany"), null);
});

test("html lang is read from the html tag", () => {
  assert.equal(htmlLanguage('<html lang="de-DE"><body>'), "de");
  assert.equal(htmlLanguage("<html class=x lang=fr>"), "fr");
  assert.equal(htmlLanguage("<html><body lang='de'>"), null);
});

test("without a declared language the domain ending picks the market", () => {
  assert.equal(marketId(chooseMarket(null, "sipgate.de")), "de-DE");
  assert.equal(marketId(chooseMarket(null, "beispiel.at")), "de-AT");
  assert.equal(marketId(chooseMarket(null, "beispiel.ch")), "de-CH");
  assert.equal(marketId(chooseMarket(null, "exemple.fr")), "fr-FR");
  assert.equal(marketId(chooseMarket(null, "ejemplo.es")), "es-ES");
  assert.equal(marketId(chooseMarket(null, "esempio.it")), "it-IT");
  assert.equal(marketId(chooseMarket(null, "voorbeeld.nl")), "nl-NL");
  assert.equal(marketId(chooseMarket(null, "voorbeeld.be")), "nl-BE");
  assert.equal(marketId(chooseMarket(null, "example.com")), "en-US");
  assert.equal(marketId(chooseMarket("en", "sipgate.de")), "en-US");
});
