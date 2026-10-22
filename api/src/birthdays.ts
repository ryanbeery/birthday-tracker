import type { Database } from './db.js'
import { upcoming } from './upcoming.js'

/** A row of the birthdays table, minus the columns only the coordinator uses. */
type BirthdayRow = {
  id: string
  name: string
  email: string
  birthday: string
  reminder_window_days: number
  gift_ideas: string | null
}

export type Birthday = ReturnType<typeof toBirthday>

const COLUMNS = 'id, name, email, birthday, reminder_window_days, gift_ideas'

/** Every entry, soonest birthday first, then by name. */
export async function listBirthdays(db: Database, today: string) {
  const { rows } = await db.query<BirthdayRow>(`SELECT ${COLUMNS} FROM birthdays`)
  // Sorted here, not in SQL, because the next birthday is computed in TypeScript.
  return rows
    .map((row) => toBirthday(row, today))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name))
}

/** One entry, or undefined if there's no row with that id (yet). */
export async function findBirthday(db: Database, id: string, today: string) {
  // The id goes in as a parameter, never into the SQL text.
  const { rows } = await db.query<BirthdayRow>(`SELECT ${COLUMNS} FROM birthdays WHERE id = $1`, [id])
  const row = rows[0]
  return row ? toBirthday(row, today) : undefined
}

function toBirthday(row: BirthdayRow, today: string) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    birthday: row.birthday,
    reminderWindowDays: row.reminder_window_days,
    // Left out when there are none, as in the queue message.
    ...(row.gift_ideas !== null && { giftIdeas: row.gift_ideas }),
    ...upcoming(row.birthday, today),
  }
}
