import pg from 'pg'

// Return DATE columns as the plain YYYY-MM-DD string. pg's default builds a JS
// Date at local midnight, which can serialize as the day before.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)

/** The part of pg's Pool the routes use, so tests can pass a mock. */
export interface Database {
  query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>
}

export function createPool(connectionString: string) {
  // Give up after 5 seconds, as the POST does with RabbitMQ, so a stuck
  // database gives a 503 instead of a hung request. The first limit covers
  // opening a connection, the second a query on an open one.
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000 })
  // Without an 'error' listener, an idle connection that drops would crash the process.
  pool.on('error', (error) => console.error('PostgreSQL connection error', error))
  return pool
}

// Node's errors for a server that can't be reached.
const NETWORK_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'])

// Postgres error classes for "can't serve you right now": 08 connection
// exception, 53 insufficient resources (e.g. too many connections), 57P
// shutting down or restarting.
const UNAVAILABLE_SQLSTATE = /^(08|53|57P)/

/**
 * True when the database can't be reached right now, so a retry may work.
 * Anything else (bad SQL, say) is a bug and gets the generic 500.
 */
export function isDatabaseUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && (NETWORK_ERRORS.has(code) || UNAVAILABLE_SQLSTATE.test(code))) {
    return true
  }
  // pg throws these without a code: a connection that dropped, no connection
  // within connectionTimeoutMillis, and no answer within query_timeout.
  return (
    error.message.startsWith('Connection terminated') ||
    error.message === 'timeout exceeded when trying to connect' ||
    error.message === 'Query read timeout'
  )
}
