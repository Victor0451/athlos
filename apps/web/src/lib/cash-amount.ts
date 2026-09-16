/** Parses a pesos amount (comma or dot decimals, no thousand separators) into exact cents. */
export const parseCashAmount = (value: string): number | null => {
  const text = value.trim()
  if (text.length > 32) return null
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text)
  if (!match) return null
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}
