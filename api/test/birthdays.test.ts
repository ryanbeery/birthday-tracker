import type { Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createApp } from '../src/app.js'

// 00:30 UTC, so it's still Oct 21 in Chicago, where the tests run (vitest.config.ts).
const NOW = new Date('2026-10-22T00:30:00Z')

const ADA_ID = '3f0c8a9e-2b1d-4c6e-9a7f-5d4b3c2a1e0f'
const BARBARA_ID = '7b2e4d1c-9f3a-4e8b-b6c5-1a0d9e8f7c6b'
const GRACE_ID = 'c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f'
const ALAN_ID = '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d'

// Rows as pg returns them: the table's own column names, and DATE as a string.
const adaRow = {
  id: ADA_ID,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  birthday: '1990-10-22',
  reminder_window_days: 7,
  gift_ideas: 'A first edition of her notes',
}
const graceRow = {
  id: GRACE_ID,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  birthday: '1906-12-09',
  reminder_window_days: 14,
  gift_ideas: null,
}
const barbaraRow = {
  id: BARBARA_ID,
  name: 'Barbara Liskov',
  email: 'barbara@example.com',
  birthday: '1939-12-09',
  reminder_window_days: 3,
  gift_ideas: null,
}
const alanRow = {
  id: ALAN_ID,
  name: 'Alan Turing',
  email: 'alan@example.com',
  birthday: '1912-06-23',
  reminder_window_days: 1,
  gift_ideas: null,
}

// What the API returns for each row on NOW's UTC date, Oct 22 2026.
const ada = {
  id: ADA_ID,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  birthday: '1990-10-22',
  reminderWindowDays: 7,
  giftIdeas: 'A first edition of her notes',
  nextBirthday: '2026-10-22',
  daysUntil: 0,
  turningAge: 36,
}
const barbara = {
  id: BARBARA_ID,
  name: 'Barbara Liskov',
  email: 'barbara@example.com',
  birthday: '1939-12-09',
  reminderWindowDays: 3,
  nextBirthday: '2026-12-09',
  daysUntil: 48,
  turningAge: 87,
}
const grace = {
  id: GRACE_ID,
  name: 'Grace Hopper',
  email: 'grace@example.com',
  birthday: '1906-12-09',
  reminderWindowDays: 14,
  nextBirthday: '2026-12-09',
  daysUntil: 48,
  turningAge: 120,
}
const alan = {
  id: ALAN_ID,
  name: 'Alan Turing',
  email: 'alan@example.com',
  birthday: '1912-06-23',
  reminderWindowDays: 1,
  nextBirthday: '2027-06-23',
  daysUntil: 244,
  turningAge: 115,
}

/** Builds an error shaped like the ones Node's sockets and pg throw. */
function dbError(message: string, code?: string) {
  return Object.assign(new Error(message), code ? { code } : {})
}

// Failures that mean the database can't be reached right now, so a retry may work.
const unavailable = [
  { label: 'a refused connection', error: dbError('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED') },
  { label: 'a dropped connection', error: dbError('Connection terminated unexpectedly') },
  { label: "pg's connection timeout", error: dbError('timeout exceeded when trying to connect') },
  { label: "pg's query timeout", error: dbError('Query read timeout') },
  { label: 'Postgres shutting down (57P01)', error: dbError('terminating connection due to administrator command', '57P01') },
  { label: 'too many connections (53300)', error: dbError('sorry, too many clients already', '53300') },
]

// A database error that isn't about reaching the database is a bug in the API.
const bug = dbError('column "nmae" does not exist', '42703')

let query: Mock
let app: Express

beforeEach(() => {
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  query = vi.fn()
  app = createApp({ publisher: { publish: vi.fn() }, db: { query } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Checks the status and the error shape, { error, details }. */
function expectError(res: request.Response, status: number) {
  expect(res.status).toBe(status)
  expect(res.body).toEqual({ error: expect.any(String), details: expect.any(Array) })
}

describe('GET /api/birthdays', () => {
  it('returns every entry sorted by days until the next birthday, then by name', async () => {
    query.mockResolvedValue({ rows: [alanRow, graceRow, adaRow, barbaraRow] })
    const res = await request(app).get('/api/birthdays')

    expect(res.status).toBe(200)
    // Exact equality also proves giftIdeas is left out when null and that no
    // snake_case or internal columns leak.
    expect(res.body).toStrictEqual([ada, barbara, grace, alan])
  })

  it('returns an empty array when there are no entries', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(app).get('/api/birthdays')

    expect(res.status).toBe(200)
    expect(res.body).toStrictEqual([])
  })

  it("counts days from today's UTC date, not the server's local date", async () => {
    // Ada's birthday is Oct 22, the UTC date. In Chicago it's still Oct 21.
    query.mockResolvedValue({ rows: [adaRow] })
    const res = await request(app).get('/api/birthdays')

    expect(res.body[0]).toMatchObject({ nextBirthday: '2026-10-22', daysUntil: 0 })
  })

  it.each(unavailable)('returns 503 for $label, logging the error instead of returning it', async ({ error }) => {
    query.mockRejectedValue(error)
    const res = await request(app).get('/api/birthdays')

    expectError(res, 503)
    expect(res.text).not.toContain(error.message)
    expect(console.error).toHaveBeenCalled()
  })

  it('returns a generic 500 for any other database error, logging it instead of returning it', async () => {
    query.mockRejectedValue(bug)
    const res = await request(app).get('/api/birthdays')

    expectError(res, 500)
    expect(res.text).not.toContain('nmae')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('GET /api/birthdays/:id', () => {
  it('returns the entry for a known id', async () => {
    query.mockResolvedValue({ rows: [adaRow] })
    const res = await request(app).get(`/api/birthdays/${ADA_ID}`)

    expect(res.status).toBe(200)
    expect(res.body).toStrictEqual(ada)
  })

  it('returns 404 in the error shape for a well-formed id with no entry', async () => {
    query.mockResolvedValue({ rows: [] })

    expectError(await request(app).get(`/api/birthdays/${ADA_ID}`), 404)
  })

  it.each([
    { label: 'abc', id: 'abc' },
    { label: 'a UUID missing a character', id: ADA_ID.slice(0, -1) },
  ])('returns 400 for $label and never queries the database', async ({ id }) => {
    expectError(await request(app).get(`/api/birthdays/${id}`), 400)
    expect(query).not.toHaveBeenCalled()
  })

  it('passes the id only as a query parameter, never inside the SQL text', async () => {
    query.mockResolvedValue({ rows: [adaRow] })
    await request(app).get(`/api/birthdays/${ADA_ID}`)

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]!
    expect(sql).not.toContain(ADA_ID)
    expect(params).toEqual([ADA_ID])
  })

  it.each(unavailable)('returns 503 for $label', async ({ error }) => {
    query.mockRejectedValue(error)

    expectError(await request(app).get(`/api/birthdays/${ADA_ID}`), 503)
  })

  it('returns a generic 500 for any other database error', async () => {
    query.mockRejectedValue(bug)
    const res = await request(app).get(`/api/birthdays/${ADA_ID}`)

    expectError(res, 500)
    expect(res.text).not.toContain('nmae')
  })
})
