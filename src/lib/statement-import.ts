import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { isCalendarDate, parseMoneyToMinorUnits, TRANSACTION_CATEGORIES } from "@/lib/finance";
import type { HouseholdCurrency } from "@/lib/types";

export type ImportTransactionType = "debit" | "income" | "refund" | "payment";

export type ImportRow = {
  sourceRow: number;
  date: string;
  postedDate: string;
  description: string;
  amountMinor: number;
  type: ImportTransactionType;
  cardholder: string;
  category: string;
  ownerUid?: string;
  included: boolean;
  warnings: string[];
  alreadyImported?: boolean;
};

export type CsvColumnMapping = {
  date: number;
  description: number;
  postedDate?: number;
  amount?: number;
  debit?: number;
  credit?: number;
  type?: number;
  cardholder?: number;
};

export type ParsedStatement = {
  rows: ImportRow[];
  statementPeriod: { start: string; end: string } | null;
  statementHash: string;
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CSV_ROWS = 1001;
const MAX_DESCRIPTION_LENGTH = 240;
const PAYMENT_PATTERN = /\b(payment received|payment\s*[-:]\s*thank you|payment thank you|autopay(?:ment)?|automatic payment|online payment|online pymt|card payment|card payoff|card pymt|cc payment|cc payoff|payment - received|payment posted|capital one (?:mobile )?(?:payment|pymt))\b/i;
const REFUND_PATTERN = /\b(refund|return|reversal|credit adjustment)\b/i;
const INCOME_PATTERN = /\b(payroll|paycheck|direct deposit|salary|interest earned|dividend)\b/i;
const SUMMARY_PATTERN = /\b(previous balance|new balance|statement balance|minimum payment|payment due|total fees|total interest|account summary|rewards summary)\b/i;

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function suggestedCategory(description: string) {
  const value = description.toLowerCase();
  if (/\b(cinemark|amc(?:\s+theat(?:er|re)s?)?|movie theat(?:er|re)|movie ticket)\b/.test(value)) return "Entertainment";
  if (/\bcostco\s+(?:gas|gasoline|fuel)\b/.test(value)) return "Transportation";
  if (/\b(internation(?:al|als|s)? food bazar(?:r)?|mayuri international|qfc)\b/.test(value)) return "Groceries";
  if (/\b(grocery|market|supermarket|whole foods|trader joe|costco|kroger|safeway)\b/.test(value)) return "Groceries";
  if (/\b(seattle city light|rent|mortgage|electric|utilities?|water bill|internet|comcast|verizon|at&t)\b/.test(value)) return "Housing & utilities";
  if (/\b(restaurant|cafe|coffee|doordash|uber eats|grubhub|chipotle|mcdonald)\b/.test(value)) return "Eatout";
  if (/\b(amazon|target|walmart|home depot|best buy|store)\b/.test(value)) return "Shopping";
  if (/\b(uber|lyft|shell|chevron|exxon|parking|transit)\b/.test(value)) return "Transportation";
  if (/\b(airline|hotel|airbnb|booking\.com)\b/.test(value)) return "Travel";
  if (/\b(pharmacy|doctor|medical|hospital|dental|gym|fitness)\b/.test(value)) return "Health and fitness";
  return "MISC";
}

function parseDate(value: string, yearHint?: number) {
  const input = value.trim().replace(/^["']|["']$/g, "");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  if (iso) {
    const date = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return isCalendarDate(date) ? date : "";
  }
  const slashIso = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(input);
  if (slashIso) {
    const date = `${slashIso[1]}-${slashIso[2].padStart(2, "0")}-${slashIso[3].padStart(2, "0")}`;
    return isCalendarDate(date) ? date : "";
  }
  const us = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(input);
  if (us) {
    const year = us[3] ? Number(us[3].length === 2 ? `20${us[3]}` : us[3]) : yearHint;
    if (!year) return "";
    const month = Number(us[1]) > 12 && Number(us[2]) <= 12 ? us[2] : us[1];
    const day = month === us[2] ? us[1] : us[2];
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return isCalendarDate(date) ? date : "";
  }
  const named = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(input);
  if (named) {
    const month = new Date(`${named[1]} 1, ${named[3]}`).getMonth() + 1;
    const date = `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
    return month > 0 && isCalendarDate(date) ? date : "";
  }
  const shortNamed = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(input);
  if (shortNamed && yearHint) {
    const month = new Date(`${shortNamed[1]} 1, ${yearHint}`).getMonth() + 1;
    const date = `${yearHint}-${String(month).padStart(2, "0")}-${shortNamed[2].padStart(2, "0")}`;
    return month > 0 && isCalendarDate(date) ? date : "";
  }
  return "";
}

export function parseStatementAmount(value: string, currency: HouseholdCurrency) {
  let normalized = value.trim().replace(/[\s\u00a0]/g, "").replace(/^[A-Z]{3}/i, "").replace(/[A-Z]{3}$/i, "");
  const isCredit = /CR$/i.test(normalized);
  const isDebit = /DR$/i.test(normalized);
  normalized = normalized.replace(/(?:CR|DR)$/i, "").replace(/^[$€£₹]/, "").replace(/^\((.*)\)$/, "-$1");
  const commaIndex = normalized.lastIndexOf(",");
  const periodIndex = normalized.lastIndexOf(".");
  if (commaIndex >= 0 && periodIndex >= 0) {
    normalized = commaIndex > periodIndex
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (commaIndex >= 0) {
    normalized = /,\d{1,2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Invalid amount.");
  const negative = normalized.startsWith("-");
  const amountMinor = parseMoneyToMinorUnits(negative ? normalized.slice(1) : normalized, currency);
  if (amountMinor <= 0) throw new Error("Amount must be greater than zero.");
  return { amountMinor, negative: negative || isCredit, explicitDebit: isDebit };
}

function makeRow(input: {
  sourceRow: number;
  date: string;
  postedDate?: string;
  description: string;
  amountMinor: number;
  type: ImportTransactionType;
  cardholder?: string;
  warnings?: string[];
  confident?: boolean;
}): ImportRow {
  const fullDescription = input.description.trim()
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card number omitted]")
    .replace(/\s+/g, " ");
  const description = fullDescription.slice(0, MAX_DESCRIPTION_LENGTH);
  const category = input.type === "income" ? "Paycheck" : suggestedCategory(description);
  const warnings = [...(input.warnings ?? [])];
  if (fullDescription.length > MAX_DESCRIPTION_LENGTH) warnings.push("The description is too long. Review the shortened merchant name.");
  if (!description) warnings.push("Add a merchant or description.");
  if (!isCalendarDate(input.date)) warnings.push("Correct the transaction date.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) warnings.push("Correct the amount.");
  if (input.type === "payment") warnings.push("Payment rows are excluded; card payments are not purchases.");
  return {
    sourceRow: input.sourceRow,
    date: input.date,
    postedDate: input.postedDate ?? "",
    description,
    amountMinor: Number.isSafeInteger(input.amountMinor) && input.amountMinor > 0 ? input.amountMinor : 0,
    type: input.type,
    cardholder: (input.cardholder ?? "").trim().slice(0, 80),
    category: (TRANSACTION_CATEGORIES as readonly string[]).includes(category) ? category : "MISC",
    included: input.type !== "payment" && warnings.length === 0 && input.confident !== false,
    warnings,
  };
}

const CSV_SYNONYMS: Record<keyof CsvColumnMapping, string[]> = {
  date: ["transaction date", "trans date", "date", "purchase date"],
  postedDate: ["posted date", "posting date", "post date"],
  description: ["description", "merchant", "transaction", "payee", "details"],
  amount: ["amount", "transaction amount"],
  debit: ["debit", "withdrawal", "charge"],
  credit: ["credit", "deposit"],
  type: ["type", "transaction type", "debit credit"],
  cardholder: ["cardholder", "card member", "member", "name"],
};

export function detectCsvMapping(headers: string[]): CsvColumnMapping | null {
  const mapping: Partial<CsvColumnMapping> = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, synonyms] of Object.entries(CSV_SYNONYMS) as [keyof CsvColumnMapping, string[]][]) {
      if (mapping[field] === undefined && synonyms.includes(normalized)) mapping[field] = index;
    }
  });
  if (mapping.date === undefined || mapping.description === undefined
    || (mapping.amount === undefined && mapping.debit === undefined && mapping.credit === undefined)) return null;
  return mapping as CsvColumnMapping;
}

export function parseCsvStatement(
  contents: Buffer | string,
  currency: HouseholdCurrency,
  mapping?: CsvColumnMapping,
  statementYear = new Date().getFullYear(),
): { headers: string[]; sample: string[][]; rows: ImportRow[]; mapping: CsvColumnMapping | null; statementPeriod: { start: string; end: string } | null } {
  let records: string[][];
  try {
    records = parseCsv(contents, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true, max_record_size: 16_384 }) as string[][];
  } catch {
    throw new Error("This CSV is malformed. Check that each row has valid quoted fields and try again.");
  }
  if (records.length < 2) throw new Error("The CSV must contain a header row and at least one transaction.");
  if (records.length > MAX_CSV_ROWS) throw new Error(`The CSV contains too many rows. The limit is ${MAX_CSV_ROWS - 1} transactions.`);
  const headers = records[0].map((value) => value.slice(0, 120));
  const detectedMapping = mapping ?? detectCsvMapping(headers);
  const sample = records.slice(1, 6).map((record) => record.map((value) => value.slice(0, 160)));
  if (!detectedMapping) return { headers, sample, rows: [], mapping: null, statementPeriod: null };
  const indices = [detectedMapping.date, detectedMapping.description, detectedMapping.amount, detectedMapping.debit, detectedMapping.credit, detectedMapping.type, detectedMapping.postedDate, detectedMapping.cardholder];
  if (detectedMapping.date === undefined
    || detectedMapping.description === undefined
    || (detectedMapping.amount === undefined && detectedMapping.debit === undefined && detectedMapping.credit === undefined)
    || indices.some((index) => index !== undefined && (!Number.isInteger(index) || index < 0 || index >= headers.length))) {
    throw new Error("Choose valid columns from the CSV header.");
  }

  const rows = records.slice(1).map((record, index) => {
    const warnings: string[] = [];
    const get = (column: number | undefined) => column === undefined ? "" : (record[column] ?? "").slice(0, 500);
    const description = get(detectedMapping.description);
    const date = parseDate(get(detectedMapping.date), statementYear);
    if (/^\d{1,2}[/-]\d{1,2}$/.test(get(detectedMapping.date).trim())) {
      warnings.push("The transaction date has no year. Verify the year.");
    }
    const postedDateValue = get(detectedMapping.postedDate);
    const postedDate = postedDateValue ? parseDate(postedDateValue, statementYear) : "";
    let amountMinor = 0;
    let negative = false;
    try {
      const amountValue = detectedMapping.debit !== undefined || detectedMapping.credit !== undefined
        ? get(detectedMapping.debit) || get(detectedMapping.credit)
        : get(detectedMapping.amount);
      if (!amountValue) throw new Error("Missing amount.");
      const parsed = parseStatementAmount(amountValue, currency);
      amountMinor = parsed.amountMinor;
      negative = parsed.negative;
    } catch {
      warnings.push("Correct the amount.");
    }
    const explicitType = get(detectedMapping.type).toLowerCase();
    const isPayment = PAYMENT_PATTERN.test(description) || /\b(?:payment|pymt|payoff)\b/.test(explicitType);
    const isRefund = REFUND_PATTERN.test(description) || /\b(refund|return|reversal)\b/.test(explicitType);
    const isIncome = INCOME_PATTERN.test(description) || /\b(income|deposit|payroll|salary)\b/.test(explicitType);
    let type: ImportTransactionType;
    let confident = true;
    if (isPayment) type = "payment";
    else if (isRefund) type = "refund";
    else if (negative) {
      type = "refund";
    }
    else if (isIncome) type = "income";
    else if (/\bcredit\b/.test(explicitType)) {
      type = "refund";
      warnings.push("This credit could be a refund or income. Confirm the transaction type.");
      confident = false;
    }
    else if (detectedMapping.credit !== undefined && get(detectedMapping.credit)) {
      const creditHeader = normalizeHeader(headers[detectedMapping.credit]);
      if (creditHeader.includes("deposit")) type = "income";
      else {
        type = "refund";
        warnings.push("A credit column may represent a refund or income. Confirm the transaction type.");
        confident = false;
      }
    }
    else if (detectedMapping.debit !== undefined && get(detectedMapping.debit)) type = "debit";
    else if (!detectedMapping.type) {
      type = "debit";
      warnings.push("Transaction type was not provided. Verify whether this is an expense, income, or refund.");
      confident = false;
    } else {
      type = "debit";
    }
    if (postedDateValue && !postedDate) warnings.push("Correct the posted date.");
    return makeRow({
      sourceRow: index + 2,
      date,
      postedDate,
      description,
      amountMinor,
      type,
      cardholder: get(detectedMapping.cardholder),
      warnings,
      confident,
    });
  });
  const validDates = rows.map((row) => row.date).filter(Boolean).sort();
  return {
    headers,
    sample,
    rows,
    mapping: detectedMapping,
    statementPeriod: validDates.length ? { start: validDates[0], end: validDates[validDates.length - 1] } : null,
  };
}

function extractPdfLines(buffer: Buffer): Promise<string[]> {
  return (async () => {
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    try {
      if (document.numPages > 100) throw new Error("The PDF has too many pages to process.");
      const lines: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const lineMap = new Map<number, Array<{ x: number; text: string }>>();
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const y = Math.round(item.transform[5] * 2) / 2;
          const entries = lineMap.get(y) ?? [];
          entries.push({ x: item.transform[4], text: item.str });
          lineMap.set(y, entries);
        }
        lines.push(...[...lineMap.entries()]
          .sort(([left], [right]) => right - left)
          .map(([, entries]) => entries.sort((left, right) => left.x - right.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim()));
        page.cleanup();
      }
      return lines;
    } finally {
      await loadingTask.destroy();
    }
  })();
}

function parseStatementPeriod(text: string) {
  const match = /(?:statement period|billing period|billing cycle)[^\d]{0,20}(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:-|to|through)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  if (!match) return null;
  const start = parseDate(match[1]);
  const end = parseDate(match[2]);
  return start && end ? { start, end } : null;
}

function parsePdfDate(value: string, period: ParsedStatement["statementPeriod"]) {
  if (!period) return parseDate(value);
  const startYear = Number(period.start.slice(0, 4));
  const endYear = Number(period.end.slice(0, 4));
  if (startYear === endYear) return parseDate(value, startYear);
  const numericMonth = /^(\d{1,2})\//.exec(value.trim());
  const namedMonth = /^([A-Za-z]{3})\s+\d{1,2}$/.exec(value.trim());
  const month = numericMonth
    ? Number(numericMonth[1])
    : namedMonth
      ? new Date(`${namedMonth[1]} 1, ${startYear}`).getMonth() + 1
      : 0;
  const startMonth = Number(period.start.slice(5, 7));
  return parseDate(value, month > 0 && month < startMonth ? endYear : startYear);
}

function parsePdfCardholder(lines: string[]) {
  for (const line of lines) {
    const match = /^\s*(?:cardholder|card member|account holder|authorized user|prepared for)\s*[:\-]\s*(.{2,80})\s*$/i.exec(line);
    if (match) return match[1].trim();
  }
  return "";
}

export async function parseCapitalOnePdf(buffer: Buffer, currency: HouseholdCurrency): Promise<ParsedStatement> {
  if (buffer.length > MAX_FILE_BYTES) throw new Error("The statement exceeds the 4 MiB file limit.");
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("This file is not a valid PDF.");
  let lines: string[];
  try {
    lines = await extractPdfLines(buffer);
  } catch {
    throw new Error("We could not read this PDF. Scanned/image-only statements are not supported yet; upload a text-based PDF or CSV export.");
  }
  const text = lines.join("\n");
  if (text.replace(/\s/g, "").length < 40) {
    throw new Error("This PDF has no usable text. Scanned/image-only statements are not supported yet; upload a text-based PDF or CSV export.");
  }
  const period = parseStatementPeriod(text);
  const cardholder = parsePdfCardholder(lines);
  let section: "purchase" | "credit" | "unknown" = "unknown";
  const rows: ImportRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/payments?, credits? and adjustments/i.test(line)) section = "credit";
    else if (/^(?:new )?transactions\b/i.test(line) || /transaction detail/i.test(line)) section = "purchase";
    if (SUMMARY_PATTERN.test(line) || /\b(annual fee|late fee|interest charged|finance charge)\b/i.test(line)) continue;
    const statementDate = "(?:\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|[A-Za-z]{3}\\s+\\d{1,2})";
    const match = new RegExp(`^\\s*(${statementDate})(?:\\s+(${statementDate}))?\\s+(.+?)\\s+(-?\\$?\\s*\\(?\\d[\\d,]*\\.\\d{2}\\)?(?:\\s*(?:CR|DR))?)\\s*$`, "i").exec(line);
    if (!match) continue;
    const description = match[3].trim();
    if (SUMMARY_PATTERN.test(description) || /\b(fee|interest charge|finance charge)\b/i.test(description)) continue;
    const date = parsePdfDate(match[1], period);
    const postedDate = match[2] ? parsePdfDate(match[2], period) : "";
    let amountMinor = 0;
    const warnings: string[] = [];
    try {
      amountMinor = parseStatementAmount(match[4], currency).amountMinor;
    } catch {
      warnings.push("Correct the amount.");
    }
    const payment = PAYMENT_PATTERN.test(description);
    const type: ImportTransactionType = payment ? "payment" : REFUND_PATTERN.test(description) || section === "credit" ? "refund" : "debit";
    const confident = Boolean(date && amountMinor && section !== "unknown");
    if (!date) warnings.push("Correct the transaction date.");
    if (section === "unknown" && !payment) warnings.push("Transaction section is unclear. Verify the type.");
    rows.push(makeRow({
      sourceRow: index + 1,
      date,
      postedDate,
      description,
      amountMinor,
      type,
      cardholder,
      warnings,
      confident,
    }));
  }
  if (!rows.length) throw new Error("No transactions were found. Confirm this is a supported Capital One text-based statement or use a CSV export.");
  return {
    rows,
    statementPeriod: period,
    statementHash: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function statementContentHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function importedTransactionId(householdId: string, statementHash: string, sourceRow: number) {
  const fingerprint = createHash("sha256")
    .update(`${householdId}\0${statementHash}\0${sourceRow}`)
    .digest("hex");
  return `import_${fingerprint}`;
}

export function statementFileLimit() {
  return MAX_FILE_BYTES;
}
