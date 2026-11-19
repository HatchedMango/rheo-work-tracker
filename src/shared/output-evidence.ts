import { z } from 'zod';
export const observeOutputSchema = z.object({ revision: z.number().int().positive() }).strict();
export type OutputObservation = {
  id: string;
  outputId: string;
  outputRevision: number;
  checkedAt: number;
  source: 'gitlab';
  status: 'observed' | 'unavailable';
  mrState: string | null;
  codeRevision: string | null;
  pipelineStatus: string | null;
  message: string;
  applicable: boolean;
};
export type OutputEvidence = {
  configured: boolean;
  omittedOutputs: number;
  outputs: {
    id: string;
    revision: number;
    kind: string;
    label: string;
    url: string;
    state: string;
    codeRevision: string;
    actorName: string;
    reportedAt: number;
    observation: OutputObservation | null;
  }[];
};
