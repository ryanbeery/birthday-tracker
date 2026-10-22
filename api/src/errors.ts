import type { ErrorRequestHandler, RequestHandler, Response } from 'express'

/** Sends the API's one error shape, `{ error, details }`. */
export function sendError(res: Response, status: number, error: string, details: unknown[] = []) {
  res.status(status).json({ error, details })
}

export const notFound: RequestHandler = (_req, res) => {
  sendError(res, 404, 'Not found')
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  // express.json() marks its client errors (malformed JSON, a body over the
  // limit) as safe to expose, with the status to use.
  if (err?.expose && err.status >= 400 && err.status < 500) {
    sendError(res, err.status, err.type === 'entity.parse.failed' ? 'Malformed JSON' : err.message)
    return
  }
  // Anything else is a bug: log the details, return nothing about them.
  console.error(err)
  sendError(res, 500, 'Internal server error')
}
