import pg from 'pg'
import { expect, it } from 'vitest'
import '../src/db.js'

// 1082 is Postgres's type id for DATE.
const DATE_OID = 1082

it('returns DATE columns as plain YYYY-MM-DD strings, not JS Dates', () => {
  const parse = pg.types.getTypeParser(DATE_OID)

  // pg's default makes a JS Date at local midnight, which serializes to JSON
  // as the day before (Feb 28) on a server in a time zone ahead of UTC.
  expect(parse('2000-02-29')).toBe('2000-02-29')
})
