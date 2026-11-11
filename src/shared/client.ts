import { readFileSync } from 'node:fs';
import { z } from 'zod';
export const credentialSchema = z.object({
  url: z
    .url()
    .refine(
      (u) => new URL(u).hostname === '127.0.0.1' && new URL(u).protocol === 'http:',
      'Only loopback HTTP is supported in this version.',
    ),
  token: z.string().min(20),
});
export function readCredential(path: string) {
  return credentialSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function apiClient(
  config: z.infer<typeof credentialSchema>,
  options: { timeoutMs?: number; diagnostic?: boolean } = {},
) {
  return async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(path, config.url), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(options.diagnostic ? { 'X-Work-Inbox-Diagnostic': '1' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
      redirect: 'error',
    });
    const data = (await response.json()) as { message?: string };
    if (!response.ok)
      throw new ApiError(response.status, data.message || `HTTP ${response.status}`);
    return data as T;
  };
}
