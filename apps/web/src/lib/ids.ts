import { nanoid } from 'nanoid'

/** Short, URL-safe ID for database rows. */
export const newId = (): string => nanoid(12)
