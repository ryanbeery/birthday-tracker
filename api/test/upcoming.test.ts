import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { upcoming } from '../src/upcoming.js'

type Case = {
  name: string
  today: string
  birthday: string
  nextBirthday: string
  daysUntil: number
  turningAge: number
}

// Shared with the coordinator's ReminderCalculator tests, so both languages
// apply the same rule (see the file's $comment).
const { cases }: { cases: Case[] } = JSON.parse(
  readFileSync(new URL('../../contracts/next-birthday-cases.json', import.meta.url), 'utf8'),
)

it.each(cases)('$name', ({ today, birthday, nextBirthday, daysUntil, turningAge }) => {
  expect(upcoming(birthday, today)).toEqual({ nextBirthday, daysUntil, turningAge })
})
