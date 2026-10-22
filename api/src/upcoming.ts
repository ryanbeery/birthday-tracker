const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When a birthday next comes around, counted from `today`. Both dates are
 * YYYY-MM-DD in UTC. The rule matches the coordinator's, and both are checked
 * against contracts/next-birthday-cases.json.
 */
export function upcoming(birthday: string, today: string) {
  const [birthYear, month, day] = birthday.split('-').map(Number) as [number, number, number]
  const start = utcDate(today)
  const thisYear = start.getUTCFullYear()

  // The next birthday on or after today: this year's, unless it has passed.
  let next = occurrence(thisYear, month, day)
  if (next < start) {
    next = occurrence(thisYear + 1, month, day)
  }

  return {
    nextBirthday: next.toISOString().slice(0, 10),
    // UTC days are always exactly 24 hours long, so this divides evenly.
    daysUntil: (next.getTime() - start.getTime()) / DAY_MS,
    turningAge: next.getUTCFullYear() - birthYear,
  }
}

/** The birthday in a given year. Feb 29 falls on Feb 28 in non-leap years. */
function occurrence(year: number, month: number, day: number) {
  const fallsOnFeb28 = month === 2 && day === 29 && !isLeapYear(year)
  return new Date(Date.UTC(year, month - 1, fallsOnFeb28 ? 28 : day))
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function utcDate(date: string) {
  return new Date(`${date}T00:00:00Z`)
}
