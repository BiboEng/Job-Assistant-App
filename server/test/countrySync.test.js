import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  ADZUNA_COUNTRIES,
  DEFAULT_ADZUNA_COUNTRY,
  INTERVIEW_MODES,
  DEFAULT_INTERVIEW_MODE,
} from "../../client/src/constants.js";

/**
 * Several lists are maintained by hand on both sides of the wire. These tests
 * fail loudly if they drift.
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

test("client INTERVIEW_MODES matches server interviewModes", () => {
  const client = [...INTERVIEW_MODES.map((m) => m.value)].sort();
  const server = [...config.interviewModes].sort();
  assert.deepEqual(client, server);
});

test("the default interview mode is type, and is a mode the server accepts", () => {
  // Not just "a valid mode": defaulting to speak would ask every visitor for a
  // camera before they'd chosen to be on one.
  assert.equal(DEFAULT_INTERVIEW_MODE, "type");
  assert.ok(config.interviewModes.includes(DEFAULT_INTERVIEW_MODE));
});
