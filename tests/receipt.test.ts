import assert from "node:assert/strict";
import test from "node:test";
import { suggestedCategory } from "@/lib/merchant-category";
import { validateReceiptImage } from "@/lib/receipt-image";
import { parseReceiptText } from "@/lib/receipt-parser";

test("receipt image validation checks actual image signatures and size", () => {
  assert.equal(validateReceiptImage(3, new Uint8Array([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(validateReceiptImage(12, new TextEncoder().encode("RIFF0000WEBP")), "image/webp");
  assert.equal(validateReceiptImage(12, new TextEncoder().encode("0000ftypheic")), "image/heic");
  assert.throws(() => validateReceiptImage(0, new Uint8Array()), /isn’t empty/);
  assert.throws(() => validateReceiptImage(10 * 1024 * 1024 + 1, new Uint8Array()), /smaller than 10 MB/);
  assert.throws(() => validateReceiptImage(8, new TextEncoder().encode("not image")), /valid JPEG/);
});

test("receipt parsing extracts merchant, unambiguous date, total, and category", () => {
  const details = parseReceiptText("WHOLE FOODS MARKET\nPurchase Date: 10/24/2026\nSubtotal $18.00\nTax $1.80\nTotal $19.80", "USD");

  assert.equal(details.merchant, "WHOLE FOODS MARKET");
  assert.equal(details.date, "2026-10-24");
  assert.equal(details.amount, "19.80");
  assert.equal(details.category, "Groceries");
  assert.deepEqual(details.warnings, []);
});

test("receipt parsing does not silently accept ambiguous totals or foreign currency", () => {
  const ambiguous = parseReceiptText("CINEMARK\nDate: 10/24/2026\nGrand Total $12.00\nGrand Total $14.00", "USD");
  assert.equal(ambiguous.amount, null);
  assert.ok(ambiguous.warnings.some((warning) => warning.includes("More than one possible final total")));

  const foreign = parseReceiptText("QFC\nDate: 10/24/2026\nTotal €12.00", "USD");
  assert.equal(foreign.amount, null);
  assert.ok(foreign.warnings.some((warning) => warning.includes("while this household uses USD")));
});

test("merchant category suggestions cover the receipt and statement rules", () => {
  assert.equal(suggestedCategory("AMC Theatres"), "Entertainment");
  assert.equal(suggestedCategory("SEATTLE CITY LIGHT"), "Housing & utilities");
  assert.equal(suggestedCategory("Costco Gas"), "Transportation");
  assert.equal(suggestedCategory("QFC"), "Groceries");
  assert.equal(suggestedCategory("Neighborhood merchant"), "MISC");
});
