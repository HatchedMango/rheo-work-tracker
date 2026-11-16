import { z } from 'zod';
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid time zone.');
export const dailyProgressQuerySchema = z.object({ timeZone: timeZoneSchema.optional() }).strict();
export const dailyTargetSchema = z
  .object({ revision: z.number().int().positive(), target: z.number().int().min(1).max(1000) })
  .strict();
export type CompletedChange = {
  id: string;
  title: string;
  completedAt: number;
  milestone: 'delivered' | 'completed';
  streamTitle: string | null;
};
export type DailyProgress = {
  metric: 'changes_done';
  target: number;
  revision: number;
  day: string;
  timeZone: string;
  nextDayAt: number;
  count: number;
  checkedAt: number;
  items: CompletedChange[];
};
