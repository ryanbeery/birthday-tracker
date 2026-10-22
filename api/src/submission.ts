import { z } from 'zod'

// Control characters, which Postgres can't always store (NUL) and logs and
// terminals can misread (escape codes). Multi-line text keeps tab, LF and CR.
const CONTROL = /\p{Cc}/u
const CONTROL_EXCEPT_TAB_AND_LINE_BREAKS = /(?![\t\n\r])\p{Cc}/u

/** A trimmed string of plain text: no control characters and no broken Unicode. */
function plainText(max: number, control: RegExp) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((text) => !control.test(text), 'Must not contain control characters')
    .refine((text) => text.isWellFormed(), 'Must not contain broken Unicode')
}

/** Today's date in UTC as YYYY-MM-DD, read on every call so it rolls over at midnight. */
function todayUtc() {
  // toISOString() is always UTC, e.g. "2026-10-22T18:40:05.123Z". The first
  // 10 characters are the date, in the same format as the birthday.
  return new Date().toISOString().slice(0, 10)
}

// YYYY-MM-DD strings sort like dates, so plain string comparison is enough.
const submissionSchema = z.strictObject({
  name: plainText(100, CONTROL).min(1, 'Must not be blank'),
  email: z.email(),
  birthday: z.iso
    .date()
    .refine((date) => date >= '1900-01-01', 'Must be in 1900 or later')
    .refine((date) => date <= todayUtc(), 'Must not be in the future'),
  reminderWindowDays: z.number().int().min(1).max(14),
  giftIdeas: plainText(500, CONTROL_EXCEPT_TAB_AND_LINE_BREAKS).optional(),
})

export type Submission = z.infer<typeof submissionSchema>
export type FieldError = { field: string; message: string }
export type ParseResult = { success: true; data: Submission } | { success: false; errors: FieldError[] }

/** Validates a POST body, trimming text and leaving out blank gift ideas. */
export function parseSubmission(body: unknown): ParseResult {
  const result = submissionSchema.safeParse(body)
  if (!result.success) {
    return { success: false, errors: toFieldErrors(result.error) }
  }
  const { giftIdeas, ...rest } = result.data
  return { success: true, data: giftIdeas ? { ...rest, giftIdeas } : rest }
}

/** One error per field, with each unknown field reported under its own name. */
function toFieldErrors(error: z.ZodError): FieldError[] {
  // Keep only the first message for each field. One is enough to fix the input.
  const messages = new Map<string, string>()
  const addOnce = (field: string, message: string) => {
    if (!messages.has(field)) messages.set(field, message)
  }

  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      // Zod reports all unknown fields in one issue, so split it up.
      for (const key of issue.keys) addOnce(key, 'Unknown field')
    } else {
      addOnce(issue.path.join('.'), issue.message)
    }
  }

  return [...messages].map(([field, message]) => ({ field, message }))
}
