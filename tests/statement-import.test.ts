import assert from "node:assert/strict";
import test from "node:test";
import {
  importedTransactionId,
  parseCapitalOnePdf,
  parseCsvStatement,
  parseStatementAmount,
  statementContentHash,
} from "../src/lib/statement-import";
import { isFirebaseAdminCredentialError, parseServiceAccountJson } from "../src/lib/statement-import-errors";

function syntheticPdf(lines: string[]) {
  const stream = [
    "BT",
    "/F1 12 Tf",
    "50 750 Td",
    ...lines.flatMap((line, index) => [index === 0 ? "" : "0 -20 Td", `(${line}) Tj`]),
    "ET",
  ].filter(Boolean).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

test("CSV parsing handles quoted merchant names and comma-separated amounts", () => {
  const csv = [
    "Transaction Date,Posted Date,Description,Amount,Type,Cardholder",
    '2025-01-02,2025-01-03,"Cafe, Downtown","1,234.56",Purchase,Alice',
  ].join("\n");
  const result = parseCsvStatement(csv, "USD");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].description, "Cafe, Downtown");
  assert.equal(result.rows[0].amountMinor, 123456);
  assert.equal(result.rows[0].type, "debit");
  assert.equal(result.rows[0].cardholder, "Alice");
  assert.equal(result.rows[0].included, true);
});

test("CSV parser separates purchases, refunds, income, and card payments", () => {
  const csv = [
    "Date,Description,Amount,Type",
    "2025-02-01,Grocer,42.50,Purchase",
    "2025-02-02,Returned shoes,25.00,Refund",
    "2025-02-03,Payroll direct deposit,1500.00,Income",
    "2025-02-04,Automatic payment,500.00,Payment",
  ].join("\n");
  const rows = parseCsvStatement(csv, "USD").rows;
  assert.deepEqual(rows.map(({ type }) => type), ["debit", "refund", "income", "payment"]);
  assert.deepEqual(rows.map(({ included }) => included), [true, true, true, false]);
  assert.ok(rows[3].warnings.some((warning) => warning.includes("not purchases")));
});

test("identical purchases on distinct rows remain independently importable", () => {
  const csv = [
    "Date,Description,Amount,Type",
    "2025-02-01,Coffee Shop,5.00,Purchase",
    "2025-02-01,Coffee Shop,5.00,Purchase",
  ].join("\n");
  const result = parseCsvStatement(csv, "USD");
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.included));
  const hash = statementContentHash(Buffer.from(csv));
  assert.notEqual(
    importedTransactionId("home", hash, result.rows[0].sourceRow),
    importedTransactionId("home", hash, result.rows[1].sourceRow),
  );
});

test("CSV parser flags ambiguous negatives and invalid dates for review", () => {
  const csv = [
    "Date,Description,Amount",
    "31/01/2025,Merchant,-12.34",
    "2025-02-30,Invalid date,12.00",
  ].join("\n");
  const rows = parseCsvStatement(csv, "USD").rows;
  assert.equal(rows[0].date, "2025-01-31");
  assert.equal(rows[0].type, "refund");
  assert.equal(rows[0].included, false);
  assert.equal(rows[1].date, "");
  assert.equal(rows[1].included, false);
});

test("CSV credit columns are not assumed to be income without clear deposit context", () => {
  const csv = [
    "Date,Description,Credit",
    "2025-02-01,Merchant credit,25.00",
  ].join("\n");
  const row = parseCsvStatement(csv, "USD").rows[0];
  assert.equal(row.type, "refund");
  assert.equal(row.included, false);
  assert.ok(row.warnings.some((warning) => warning.includes("refund or income")));
});

test("oversized descriptions are visibly flagged instead of silently accepted", () => {
  const description = "M".repeat(250);
  const row = parseCsvStatement(`Date,Description,Amount,Type\n2025-02-01,${description},1.00,Purchase`, "USD").rows[0];
  assert.equal(row.description.length, 240);
  assert.equal(row.included, false);
  assert.ok(row.warnings.some((warning) => warning.includes("description is too long")));
});

test("CSV requires a supported header or valid explicit mapping", () => {
  assert.equal(parseCsvStatement("not,a,header\nx,y,z", "USD").mapping, null);
  assert.throws(() => parseCsvStatement("Date,Description,Amount\n2025-01-01,Shop,1.00", "USD", {
    date: 0, description: 1, amount: 3,
  }), /Choose valid columns/);
  const invalidAmount = parseCsvStatement("Date,Description,Amount\n2025-01-01,Shop,not-money", "USD").rows[0];
  assert.equal(invalidAmount.included, false);
  assert.ok(invalidAmount.warnings.some((warning) => warning.includes("amount")));
});

test("CSV parser rejects malformed and empty statements", () => {
  assert.throws(() => parseCsvStatement("Date,Description,Amount", "USD"), /header row and at least one transaction/);
  assert.throws(() => parseCsvStatement('Date,Description,Amount\n2025-01-01,"unfinished,4.00', "USD"), /malformed/);
});

test("statement amount parser accepts common US and European decimal notation", () => {
  assert.equal(parseStatementAmount("$1,234.56", "USD").amountMinor, 123456);
  assert.equal(parseStatementAmount("1.234,56 EUR", "EUR").amountMinor, 123456);
  assert.equal(parseStatementAmount("(12.50)", "USD").negative, true);
  assert.equal(parseStatementAmount("12.50CR", "USD").negative, true);
  assert.throws(() => parseStatementAmount("12.345", "USD"));
});

test("Capital One text PDFs extract purchases while excluding payment summaries", async () => {
  const pdf = syntheticPdf([
    "Statement period 12/20/2025 - 01/19/2026",
    "Cardholder: Alice Example",
    "Transactions",
    "12/29/2025 WHOLE FOODS MARKET $42.10",
    "Payments, Credits and Adjustments",
    "01/05/2026 RETURN MERCHANT $10.00",
    "01/06/2026 PAYMENT - THANK YOU $500.00",
    "New balance $500.00",
  ]);
  const result = await parseCapitalOnePdf(pdf, "USD");
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].description, "WHOLE FOODS MARKET");
  assert.equal(result.rows[0].type, "debit");
  assert.equal(result.rows[0].date, "2025-12-29");
  assert.equal(result.rows[0].cardholder, "Alice Example");
  assert.equal(result.rows[0].amountMinor, 4210);
  assert.equal(result.rows[1].type, "refund");
  assert.equal(result.rows[1].date, "2026-01-05");
  assert.equal(result.rows[1].included, true);
  assert.equal(result.rows[2].type, "payment");
  assert.equal(result.rows[2].included, false);
  assert.deepEqual(result.statementPeriod, { start: "2025-12-20", end: "2026-01-19" });
  assert.equal(result.statementHash, statementContentHash(pdf));
});

test("unsupported PDFs fail clearly and repeated purchases have distinct stable IDs", async () => {
  await assert.rejects(parseCapitalOnePdf(Buffer.from("not a PDF"), "USD"), /not a valid PDF/);
  await assert.rejects(parseCapitalOnePdf(syntheticPdf([""]), "USD"), /Scanned\/image-only statements are not supported/);
  const hash = statementContentHash(Buffer.from("synthetic statement"));
  const first = importedTransactionId("home", hash, 2);
  const repeatedPurchase = importedTransactionId("home", hash, 3);
  assert.equal(first, importedTransactionId("home", hash, 2));
  assert.notEqual(first, repeatedPurchase);
});

test("Firebase Admin credential failures are recognized without exposing credential details", () => {
  assert.equal(isFirebaseAdminCredentialError(new Error("Could not load the default credentials.")), true);
  assert.equal(isFirebaseAdminCredentialError({
    message: "Request failed",
    cause: new Error("Could not determine project ID"),
  }), true);
  assert.equal(isFirebaseAdminCredentialError(new Error("Permission denied")), false);
});

test("Firebase Admin parses escaped-quote .env JSON and rejects malformed credentials safely", () => {
  const account = parseServiceAccountJson(String.raw`{\"type\":\"service_account\",\"project_id\":\"demo\",\"client_email\":\"importer@example.test\",\"private_key\":\"line1\\nline2\"}`);
  assert.deepEqual(account, { projectId: "demo", clientEmail: "importer@example.test", privateKey: "line1\nline2" });
  const lineWrappedAccount = String.raw`{\"type\":\"service_account\",\"project_id\":\"demo\",\"client_email\":\"importer@example.test\",\"private_key\":\"line1` + "\\" + "\n" + String.raw`line2\"}`;
  assert.equal(parseServiceAccountJson(lineWrappedAccount).privateKey, "line1\nline2");
  assert.throws(() => parseServiceAccountJson("{not-json}"), /FIREBASE_SERVICE_ACCOUNT_JSON is malformed/);
});
