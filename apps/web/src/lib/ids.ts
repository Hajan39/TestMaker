import { nanoid } from 'nanoid'

/** Krátké, URL-bezpečné ID pro řádky v databázi. */
export const newId = (): string => nanoid(12)
