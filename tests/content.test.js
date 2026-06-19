import test from "node:test";
import assert from "node:assert/strict";
import { cleanDate, normalizeDocumentKind, sanitizeRichText } from "../src/lib/content.js";

test("cleanDate rejects malformed values", () => {
  assert.equal(cleanDate("2026-06-19"), "2026-06-19");
  assert.equal(cleanDate("19/06/2026"), "");
});

test("normalizeDocumentKind classifies legacy titles", () => {
  assert.equal(normalizeDocumentKind("", "PV reunion CSE"), "pv");
  assert.equal(normalizeDocumentKind("", "Ordre du jour - juin"), "odj");
});

test("sanitizeRichText removes executable markup", () => {
  const value = sanitizeRichText('<p>Bonjour</p><img src=x onerror="alert(1)"><a href="javascript:alert(1)">Lien</a>', 500);
  assert.match(value, /Bonjour/);
  assert.doesNotMatch(value, /onerror|javascript:/i);
});
