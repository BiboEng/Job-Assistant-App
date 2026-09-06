import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  ADZUNA_COUNTRIES,
  DEFAULT_ADZUNA_COUNTRY,
} from "../../client/src/constants.js";

/**
 * The client's country dropdown and the server's allow-list are maintained by
 * hand in two files. This test fails loudly if they drift.
 */

test("client ADZUNA_COUNTRIES matches server adzuna.supportedCountries", () => {
  const client = [...ADZUNA_COUNTRIES.map((c) => c.code)].sort();
  const server = [...config.adzuna.supportedCountries].sort();
  assert.deepEqual(client, server);
});

test("every supported country has a currency mapping", () => {
  for (const code of config.adzuna.supportedCountries) {
    const money = config.adzuna.currencyByCountry[code];
    assert.ok(money && money.currency && money.locale, `missing currency for ${code}`);
  }
});

test("the default Adzuna country is one that is actually supported", () => {
  assert.ok(config.adzuna.supportedCountries.includes(config.adzuna.country));
  assert.ok(config.adzuna.supportedCountries.includes(DEFAULT_ADZUNA_COUNTRY));
});
