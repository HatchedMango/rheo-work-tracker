import { z } from 'zod';
export const requestGuidanceSchema = z
  .object({
    steps: z.array(z.string().trim().min(1).max(400)).max(5).default([]),
    why: z.string().trim().max(400).default(''),
    recommendation: z.string().trim().max(400).default(''),
    copy: z
      .object({ label: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(2000) })
      .strict()
      .optional(),
  })
  .strict();
export type RequestGuidance = z.infer<typeof requestGuidanceSchema>;
export function readRequestGuidance(value: unknown): RequestGuidance {
  return requestGuidanceSchema.parse(typeof value === 'string' ? JSON.parse(value) : (value ?? {}));
}
