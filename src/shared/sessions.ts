import { z } from 'zod';
export const sessionListSchema = z
  .object({
    streamId: z.uuid().optional(),
    directOnly: z.literal('true').optional(),
    changeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(30).default(10),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .refine((p) => Boolean(p.streamId) !== Boolean(p.changeId), 'Select one stream or change.')
  .refine((p) => !p.directOnly || !!p.streamId, 'Direct stream sessions require a stream.');
export type WorkSession = {
  id: string;
  sessionId: string;
  client: 'codex' | 'claude-code';
  project: string;
  streamId: string | null;
  changeId: string | null;
  title: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastEvent: string;
  summary: string;
  lastCheckpointAt: number | null;
  selected: boolean;
  connectionActive: boolean;
  relatedWorkCount: number;
};
export type SessionPage = { items: WorkSession[]; total: number; nextOffset: number | null };

export type SessionLink = Pick<WorkSession, 'id' | 'sessionId' | 'client'>;
export type SessionLinks = { items: SessionLink[]; total: number; resumable?: boolean };
