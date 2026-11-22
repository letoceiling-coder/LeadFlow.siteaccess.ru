/** Строка из чужих данных («=IMPORTXML(...)» в названии компании) не должна стать формулой в Google Таблице. */
export function sheetSafe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
