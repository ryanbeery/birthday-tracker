import type { Submission } from './submission.js'

/** The message on `birthday.submissions` that the coordinator saves (see CLAUDE.md). */
export type SubmissionMessage = Submission & { id: string; submittedAt: string }

export interface SubmissionPublisher {
  /** Resolves once the broker confirms the message, and rejects if publishing fails. */
  publish(message: SubmissionMessage): Promise<void>
}
