/** Shared merchant-based suggestion for statement imports and receipt review. */
export function suggestedCategory(description: string) {
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
