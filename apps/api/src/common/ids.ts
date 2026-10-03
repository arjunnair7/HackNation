import { randomBytes } from 'node:crypto';

/** Short, URL- and filename-safe ids like "s_3f9a1c2b". */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
