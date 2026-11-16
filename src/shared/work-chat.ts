import { z } from 'zod';
export const workChatSchema = z
  .object({
    client: z.enum(['codex', 'claude-code']).optional(),
    project: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export type ChatDestination = { client: 'codex' | 'claude-code'; project: string };
export type WorkChat = {
  changeId: string;
  title: string;
  mode: 'start' | 'resume';
  brief: string;
  destination: ChatDestination;
  destinations: ChatDestination[];
  projectRequired: boolean;
  sessionId: string | null;
  conversationUrl: string | null;
  draftUrl: string | null;
  command: string | null;
};
