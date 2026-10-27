/** Returns a copy of options sorted by their user-facing labels. */
export function sortOptionsAlphabetically<T>(
  options: readonly T[],
  getLabel: (option: T) => string,
): T[] {
  return [...options].sort((first, second) =>
    getLabel(first).localeCompare(getLabel(second), undefined, { sensitivity: "base" }),
  );
}
