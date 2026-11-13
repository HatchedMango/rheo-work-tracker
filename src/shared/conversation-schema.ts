import { z } from 'zod';
import { conversationLink } from './conversation.js';
export const conversationUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) => conversationLink(value) !== null,
    'Use an HTTP(S) chat URL or codex://threads/UUID without commands or credentials.',
  );
