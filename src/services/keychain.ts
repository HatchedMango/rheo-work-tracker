import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface GitLabKeychain {
  write(id: string, token: string): void | Promise<void>;
  read(id: string): string | Promise<string>;
  remove(id: string): void | Promise<void>;
}
export function nativeKeychain(): GitLabKeychain {
  const packaged = fileURLToPath(new URL('../native/rheo-keychain', import.meta.url));
  const source = fileURLToPath(new URL('../../dist/native/rheo-keychain', import.meta.url));
  const helper = existsSync(packaged) ? packaged : source;
  function invoke(action: string, id: string, token?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        helper,
        [],
        { encoding: 'utf8', timeout: 15000, maxBuffer: 8192 },
        (error, stdout) => {
          if (error)
            reject(
              new Error(
                'macOS Keychain access is unavailable. Unlock your keychain or check local access policy, then retry.',
              ),
            );
          else resolve(stdout.trim());
        },
      );
      // Secrets travel over stdin/stdout only, never arguments or the environment.
      child.stdin?.on('error', () => {
        /* The callback reports a failed helper. */
      });
      child.stdin?.end(JSON.stringify({ action, id, ...(token === undefined ? {} : { token }) }));
    });
  }
  return {
    write: async (id, token) => {
      await invoke('write', id, token);
    },
    read: (id) => invoke('read', id),
    remove: async (id) => {
      await invoke('remove', id);
    },
  };
}
