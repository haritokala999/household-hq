import { suggestedCategory } from "@/lib/merchant-category";
import type { HouseholdCurrency } from "@/lib/types";

export type ParsedReceiptDetails = {
  merchant: string | null;
  date: string | null;
  amount: string | null;
  category: string | null;
  receiptCurrency: string | null;
  warnings: string[];
};

const monthNames: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
  october: "10", nov: "11", november: "11", dec: "12", december: "12",
};
const datePattern = /\b(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/g;
const currencyCodes = "USD|CAD|EUR|GBP|INR|SAR|KWD";
const moneyPattern = new RegExp(
  `(?:\\b(${currencyCodes})\\s*)?([$€£₹])?\\s*(\\(?-?\\d{1,3}(?:[,. ]\\d{3})+(?:[,.]\\d{1,3})?|\\(?-?\\d+(?:[,.]\\d{1,3})?\\)?)(?:\\s*(${currencyCodes})\\b)?`,
  "gi",
);

function validDate(year: number, month: number, day: number) {
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? result
    : null;
}

function parseDateToken(token: string) {
  const value = token.trim().replace(/,/g, "");
  const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (numeric) {
    const yearValue = Number(numeric[3]);
    const year = numeric[3].length === 2 ? 2000 + yearValue : yearValue;
    return validDate(year, Number(numeric[1]), Number(numeric[2]));
  }

  const named = /^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/.exec(value);
  if (named) {
    const month = monthNames[named[1].toLowerCase()];
    return month ? validDate(Number(named[3]), Number(month), Number(named[2])) : null;
  }
  return null;
}

function extractDates(value: string) {
  return [...value.matchAll(datePattern)]
    .map((match) => parseDateToken(match[0]))
    .filter((date): date is string => date !== null);
}

function findReceiptDate(lines: string[]) {
  const labeledIndices = lines.flatMap((line, index) =>
    /\b(?:transaction|purchase)?\s*date\b/i.test(line) && !/\b(due|delivery|ship|expiration)\b/i.test(line)
      ? [index]
      : [],
  );
  const dates = labeledIndices.length
    ? [...new Set(labeledIndices.flatMap((index) => {
        const onLabel = extractDates(lines[index]);
        return onLabel.length ? onLabel : extractDates(lines[index + 1] ?? "");
      }))]
    : [...new Set(lines.flatMap(extractDates))];
  return dates.length === 1 ? dates[0] : null;
}

function findMerchant(lines: string[]) {
  const candidate = lines.find((line) => {
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    return letters >= 3
      && !/\b(receipt|invoice|order\s*(?:number|#|no\.?|id)|transaction|date|time|cashier|register|tel|phone|thank you|welcome|www\.|https?:)\b/i.test(line)
      && !extractDates(line).length;
  });
  return candidate?.replace(/\s+/g, " ").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.'&)\-]+$/g, "").trim().slice(0, 120) || null;
}

function normalizeAmount(raw: string) {
  const value = raw.replace(/[()\s]/g, "");
  const lastComma = value.lastIndexOf(",");
  const lastPeriod = value.lastIndexOf(".");
  if (lastComma >= 0 && lastPeriod >= 0) {
    return lastComma > lastPeriod
      ? value.replace(/\./g, "").replace(",", ".")
      : value.replace(/,/g, "");
  }
  if (lastComma >= 0) {
    return /,\d{1,3}$/.test(value) && !/,\d{3}$/.test(value)
      ? value.replace(",", ".")
      : value.replace(/,/g, "");
  }
  const periods = (value.match(/\./g) ?? []).length;
  if (periods > 1) return value.replace(/\./g, "");
  if (/\.\d{3}$/.test(value) && /^\d{1,3}\.\d{3}$/.test(value)) return value.replace(".", "");
  return value;
}

function detectCurrency(line: string, householdCurrency: HouseholdCurrency) {
  const code = new RegExp(`\\b(${currencyCodes})\\b`, "i").exec(line)?.[1]?.toUpperCase();
  if (code) return code;
  if (line.includes("€")) return "EUR";
  if (line.includes("£")) return "GBP";
  if (line.includes("₹")) return "INR";
  if (line.includes("ر.س")) return "SAR";
  if (line.includes("د.ك")) return "KWD";
  if (line.includes("$")) return householdCurrency === "USD" || householdCurrency === "CAD" ? householdCurrency : "ambiguous";
  return null;
}

function extractAmountCandidates(line: string) {
  const candidates: Array<{ amount: string; negative: boolean }> = [];
  for (const match of line.matchAll(moneyPattern)) {
    const raw = match[3];
    if (!raw) continue;
    const negative = raw.includes("-") || (raw.startsWith("(") && raw.endsWith(")"));
    const amount = normalizeAmount(raw.replace(/[()]/g, ""));
    if (/^-?\d+(?:\.\d{1,3})?$/.test(amount)) candidates.push({ amount: amount.replace(/^-/, ""), negative });
  }
  return candidates;
}

function findReceiptTotal(lines: string[], householdCurrency: HouseholdCurrency) {
  const candidates: Array<{ priority: number; amount: string; negative: boolean; currency: string | null }> = [];
  for (const [index, line] of lines.entries()) {
    const normalized = line.toLowerCase();
    if (/\b(subtotal|tax|sales tax|vat|tip|gratuity|discount|savings|change|cash tendered|amount tendered|visa|mastercard|amex|debit|credit card|balance forward)\b/.test(normalized)) continue;

    let priority = 0;
    if (/\b(grand total|total due|amount due|balance due|final total)\b/.test(normalized)) priority = 3;
    else if (/\btotal(?:\s+(?:paid|including tax))?\b/.test(normalized)) priority = 2;
    if (!priority) continue;

    const amounts = extractAmountCandidates(line);
    const followingLine = lines[index + 1] ?? "";
    const combinedLine = amounts.length ? line : `${line} ${followingLine}`;
    const selectedAmounts = amounts.length ? amounts : extractAmountCandidates(followingLine);
    if (selectedAmounts.length !== 1) continue;
    candidates.push({
      priority,
      ...selectedAmounts[0],
      negative: selectedAmounts[0].negative || /-\s*[$€£₹]?\s*\d|\(\s*[$€£₹]?\s*\d/.test(combinedLine),
      currency: detectCurrency(combinedLine, householdCurrency),
    });
  }

  if (!candidates.length) return { amount: null, currency: null, ambiguous: false, negative: false };
  const bestPriority = Math.max(...candidates.map((candidate) => candidate.priority));
  const best = candidates.filter((candidate) => candidate.priority === bestPriority);
  const distinctAmounts = [...new Set(best.map((candidate) => candidate.amount))];
  const distinctCurrencies = [...new Set(best.map((candidate) => candidate.currency).filter((currency): currency is string => currency !== null))];
  if (distinctAmounts.length > 1 || distinctCurrencies.length > 1) {
    return { amount: null, currency: null, ambiguous: true, negative: false };
  }
  return {
    amount: best[0].amount,
    currency: distinctCurrencies[0] ?? null,
    ambiguous: false,
    negative: best.some((candidate) => candidate.negative),
  };
}

export function parseReceiptText(text: string, householdCurrency: HouseholdCurrency): ParsedReceiptDetails {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[\t\u00a0]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const merchant = findMerchant(lines);
  const date = findReceiptDate(lines);
  const total = findReceiptTotal(lines, householdCurrency);
  const warnings: string[] = [];

  if (!merchant) warnings.push("Merchant not found. Enter a description.");
  if (!date) warnings.push("Receipt date was not found or is ambiguous. Choose the transaction date.");
  if (total.ambiguous) warnings.push("More than one possible final total was found. Enter the correct amount.");
  else if (!total.amount) warnings.push("A final total could not be identified. Enter the amount.");
  else if (total.negative) warnings.push("The receipt total appears negative. Confirm the amount and transaction type.");
  else if (total.currency === "ambiguous") warnings.push("The receipt currency is unclear. Confirm the amount in the household currency.");
  else if (total.currency && total.currency !== householdCurrency) {
    warnings.push(`The receipt is in ${total.currency}, while this household uses ${householdCurrency}. Convert the amount before saving.`);
  }

  const amount = total.negative || total.currency === "ambiguous" || (total.currency && total.currency !== householdCurrency)
    ? null
    : total.amount;

  return {
    merchant,
    date,
    amount,
    category: merchant ? suggestedCategory(merchant) : null,
    receiptCurrency: total.currency === "ambiguous" ? null : total.currency,
    warnings,
  };
}
