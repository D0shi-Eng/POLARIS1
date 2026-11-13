// الترجمة: تكافؤ المفاتيح، والتراجع، والجمع، والاتجاه، والتنسيق.

import assert from "node:assert/strict";
import { test } from "node:test";

import { firstDayOfWeek, formatInstant, formatNumber, isolate } from "../src/localization/format";
import { CATALOGS } from "../src/localization/catalog/index";
import { createTranslator, keysOf, MissingKeyRecorder } from "../src/localization/translate";
import { directionOf, isLocale, LOCALES, PROVEN_LOCALES } from "../src/localization/types";

test("the nine architectural locales all exist", () => {
  assert.equal(LOCALES.length, 9);
  for (const locale of LOCALES) {
    assert.ok(CATALOGS[locale] !== undefined, `${locale} has no catalog`);
    assert.ok(Object.keys(CATALOGS[locale]).length > 0, `${locale} is empty`);
  }
});

test("Arabic and English declare exactly the same keys", () => {
  const ar = keysOf("ar");
  const en = keysOf("en");
  const missingInAr = en.filter((key) => !ar.includes(key));
  const missingInEn = ar.filter((key) => !en.includes(key));
  // مفاتيح الجمع العربية الست لا مقابل لها في الإنجليزية، وهذا صحيح لا نقص.
  const pluralOnly = missingInEn.filter((key) => /\.(zero|two|few|many)$/.test(key));
  assert.deepEqual(missingInAr, [], `Arabic is missing: ${missingInAr.join(", ")}`);
  assert.deepEqual(
    missingInEn.filter((key) => !pluralOnly.includes(key)),
    [],
    `English is missing: ${missingInEn.join(", ")}`,
  );
});

test("the proven locales are Arabic and English", () => {
  assert.deepEqual([...PROVEN_LOCALES], ["ar", "en"]);
});

test("the seven architectural locales resolve through fallback with no missing key", () => {
  const recorder = new MissingKeyRecorder();
  const englishKeys = keysOf("en");
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const translator = createTranslator(locale, recorder);
    for (const key of englishKeys) translator.t(key);
  }
  assert.equal(recorder.size, 0, `unresolved keys: ${recorder.list().join(", ")}`);
});

test("a missing key is recorded and returns the key, never invented prose", () => {
  const recorder = new MissingKeyRecorder();
  const translator = createTranslator("en", recorder);
  assert.equal(translator.t("no.such.key"), "no.such.key");
  assert.deepEqual(recorder.list(), ["en:no.such.key"]);
});

test("interpolation fills placeholders and leaves unknown ones visible", () => {
  const translator = createTranslator("en");
  assert.equal(translator.t("route.unknown.body", { route: "/nope" }), "The address /nope is not part of this build.");
});

test("plural forms come from the locale's rules, not from concatenation", () => {
  const english = createTranslator("en");
  assert.equal(english.plural("common.count", 1), "1 item");
  assert.equal(english.plural("common.count", 5), "5 items");

  const arabic = createTranslator("ar");
  assert.equal(arabic.plural("common.count", 0), "لا عناصر");
  assert.equal(arabic.plural("common.count", 1), "عنصر واحد");
  assert.equal(arabic.plural("common.count", 2), "عنصران");
  assert.equal(arabic.plural("common.count", 3), "3 عناصر");
  assert.equal(arabic.plural("common.count", 11), "11 عنصرًا");
});

test("direction derives from the locale", () => {
  assert.equal(directionOf("ar"), "rtl");
  for (const locale of LOCALES.filter((code) => code !== "ar")) {
    assert.equal(directionOf(locale), "ltr", `${locale} should be ltr`);
  }
});

test("locale guards reject anything outside the nine", () => {
  assert.equal(isLocale("ar"), true);
  assert.equal(isLocale("pt"), false);
  assert.equal(isLocale(7), false);
});

test("numbers are formatted by the locale, not by hand", () => {
  assert.equal(formatNumber("en", 1234567), "1,234,567");
  assert.notEqual(formatNumber("de", 1234567), formatNumber("en", 1234567));
  assert.equal(formatNumber("en", 0), "0");
});

test("instants are formatted by the locale and an invalid instant is returned as given", () => {
  const formatted = formatInstant("en", "2026-09-15T08:30:00Z");
  assert.ok(formatted.length > 0);
  assert.notEqual(formatted, "2026-09-15T08:30:00Z");
  assert.equal(formatInstant("en", "not-a-date"), "not-a-date");
});

test("the first day of the week is locale-aware and bounded", () => {
  for (const locale of LOCALES) {
    const day = firstDayOfWeek(locale);
    assert.ok(day >= 1 && day <= 7, `${locale} produced ${day}`);
  }
});

test("bidirectional isolation wraps a value without changing it", () => {
  const wrapped = isolate("0.1.0");
  assert.ok(wrapped.startsWith("⁦") && wrapped.endsWith("⁩"));
  assert.ok(wrapped.includes("0.1.0"));
});

test("no catalog entry contains a hard-coded grammatical join", () => {
  // علامة على تركيب الجملة بالضمّ: مفتاح ينتهي بفراغ أو يبدأ بفاصلة أو شرطة وصل.
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(CATALOGS[locale])) {
      assert.equal(value, value.trim(), `${locale}:${key} has edge whitespace, a sign of concatenation`);
      assert.ok(!/^[,;:—-]/.test(value), `${locale}:${key} starts with a joining mark`);
    }
  }
});
