// Calls to the API. The browser stays on one origin: nginx (in Compose) or
// Vite's dev server forwards /api to the API.

/** One entry, as GET /api/birthdays and GET /api/birthdays/:id return it. */
export type Birthday = {
  id: string
  name: string
  email: string
  birthday: string
  reminderWindowDays: number
  giftIdeas?: string
  nextBirthday: string
  daysUntil: number
  turningAge: number
}

export type NewBirthday = {
  name: string
  email: string
  birthday: string
  reminderWindowDays: number
  giftIdeas?: string
}

export type FieldError = { field: string; message: string }

/** A failed request, with the API's error message and any field errors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message)
  }
}

export function listBirthdays() {
  return request<Birthday[]>('/api/birthdays')
}

export function getBirthday(id: string) {
  return request<Birthday>(`/api/birthdays/${encodeURIComponent(id)}`)
}

export function createBirthday(birthday: NewBirthday) {
  return request<{ id: string }>('/api/birthdays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(birthday),
  })
}

/** The message to show for an error from one of the calls above. */
export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong, try again'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'Could not reach the server, check your connection')
  }

  // Errors from the API itself are JSON. One from nginx (the API is down) isn't.
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    if (typeof body?.error === 'string') {
      throw new ApiError(response.status, body.error, body.details ?? [])
    }
    throw new ApiError(response.status, 'The server is unavailable, try again shortly')
  }
  return body as T
}
