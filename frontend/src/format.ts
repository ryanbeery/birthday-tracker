/** Today's date in UTC as YYYY-MM-DD, the same "today" the API uses. */
export function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

/** "December 10, 1990" for "1990-12-10", read as a UTC date so it never shifts a day. */
export function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'long' })
}

/** "today", "tomorrow" or "in 12 days". */
export function formatDaysUntil(days: number) {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}
