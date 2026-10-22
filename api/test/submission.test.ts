import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSubmission } from '../src/submission.js'

// 00:30 UTC on Oct 22 is still Oct 21 in Chicago, where the tests run.
const NOW = new Date('2026-10-22T00:30:00Z')

const required = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  birthday: '1990-12-10',
  reminderWindowDays: 7,
}
const valid = { ...required, giftIdeas: 'A first edition of her notes' }

/** The fields a submission was rejected for, or [] if it was accepted. */
function rejectedFields(body: unknown) {
  const result = parseSubmission(body)
  return result.success ? [] : [...new Set(result.errors.map((e) => e.field))]
}

beforeEach(() => {
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseSubmission', () => {
  it('accepts a valid submission as is', () => {
    expect(parseSubmission(valid)).toEqual({ success: true, data: valid })
  })

  it('accepts a submission without gift ideas', () => {
    expect(parseSubmission(required)).toEqual({ success: true, data: required })
  })

  it.each([
    { field: 'name', value: ` ${'x'.repeat(100)} `, label: 'a name of 100 characters after trimming' },
    { field: 'name', value: 'Émilie du Châtelet', label: 'a name with accented letters' },
    { field: 'birthday', value: '2024-02-29', label: 'a leap day' },
    { field: 'birthday', value: '1900-01-01', label: 'the earliest allowed date' },
    { field: 'birthday', value: '2026-10-22', label: "today's UTC date" },
    { field: 'reminderWindowDays', value: 1, label: 'a window of 1' },
    { field: 'reminderWindowDays', value: 14, label: 'a window of 14' },
    { field: 'giftIdeas', value: ` ${'x'.repeat(500)} `, label: 'gift ideas of 500 characters after trimming' },
    { field: 'giftIdeas', value: 'Books:\r\n\tpoetry', label: 'gift ideas with a tab and a Windows line break' },
    { field: 'giftIdeas', value: 'A 🎂 and a card', label: 'gift ideas with an emoji' },
  ])('accepts $label', ({ field, value }) => {
    expect(rejectedFields({ ...valid, [field]: value })).toEqual([])
  })

  it.each([
    { field: 'name', value: undefined, label: 'a missing name' },
    { field: 'name', value: '', label: 'an empty name' },
    { field: 'name', value: '   ', label: 'a name of only spaces' },
    { field: 'name', value: ` ${'x'.repeat(101)} `, label: 'a name of 101 characters after trimming' },
    { field: 'name', value: 'Ada\nLovelace', label: 'a line break in a name' },
    { field: 'name', value: 'Ada\tLovelace', label: 'a tab in a name' },
    { field: 'name', value: '\u001b[31mAda', label: 'an escape code in a name' },
    { field: 'name', value: 'Ada\u0000', label: 'a NUL in a name' },
    { field: 'name', value: 'Ada\uD800', label: 'broken Unicode in a name' },
    { field: 'email', value: undefined, label: 'a missing email' },
    { field: 'email', value: 'not-an-email', label: 'an email without an @' },
    { field: 'email', value: 'ada@example', label: 'an email without a top-level domain' },
    { field: 'birthday', value: undefined, label: 'a missing birthday' },
    { field: 'birthday', value: '2023-02-30', label: 'Feb 30' },
    { field: 'birthday', value: '2023-02-29', label: 'Feb 29 in a non-leap year' },
    { field: 'birthday', value: '2023-13-01', label: 'month 13' },
    { field: 'birthday', value: '2023-2-3', label: 'a date without zero padding' },
    { field: 'birthday', value: '2023-02-03T00:00:00Z', label: 'a timestamp' },
    { field: 'birthday', value: '1899-12-31', label: 'a date before 1900' },
    { field: 'birthday', value: '2026-10-23', label: "tomorrow's UTC date" },
    { field: 'birthday', value: 20230203, label: 'a number for a date' },
    { field: 'reminderWindowDays', value: undefined, label: 'a missing window' },
    { field: 'reminderWindowDays', value: 0, label: 'a window of 0' },
    { field: 'reminderWindowDays', value: 15, label: 'a window of 15' },
    { field: 'reminderWindowDays', value: 7.5, label: 'a window of 7.5' },
    { field: 'reminderWindowDays', value: '7', label: 'a window sent as a string' },
    { field: 'giftIdeas', value: ` ${'x'.repeat(501)} `, label: 'gift ideas of 501 characters after trimming' },
    { field: 'giftIdeas', value: 'Books\u0000', label: 'a NUL in gift ideas' },
    { field: 'giftIdeas', value: '\u001b[31mBooks', label: 'an escape code in gift ideas' },
    { field: 'giftIdeas', value: 'Books\uDC00', label: 'broken Unicode in gift ideas' },
  ])('rejects $label, naming the field', ({ field, value }) => {
    expect(rejectedFields({ ...valid, [field]: value })).toEqual([field])
  })

  it('rejects an unknown field such as id, naming it', () => {
    expect(rejectedFields({ ...valid, id: '5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90' })).toEqual(['id'])
  })

  it('rejects a body that is not an object', () => {
    expect(parseSubmission([valid])).toMatchObject({ success: false })
  })

  it('trims the name and gift ideas', () => {
    expect(parseSubmission({ ...valid, name: '  Ada  ', giftIdeas: '  Books  ' })).toEqual({
      success: true,
      data: { ...valid, name: 'Ada', giftIdeas: 'Books' },
    })
  })

  it.each(['', '   '])('leaves out blank gift ideas (%j)', (giftIdeas) => {
    expect(parseSubmission({ ...required, giftIdeas })).toEqual({ success: true, data: required })
  })

  it('reads today at each validation, not once at startup', () => {
    const tomorrow = { ...valid, birthday: '2026-10-23' }
    expect(rejectedFields(tomorrow)).toEqual(['birthday'])

    vi.setSystemTime(new Date('2026-10-23T00:30:00Z'))
    expect(rejectedFields(tomorrow)).toEqual([])
  })
})
