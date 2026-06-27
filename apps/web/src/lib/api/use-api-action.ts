'use client';

import { useCallback } from 'react';
import { signOut } from 'next-auth/react';
import { isAuthError } from './client';

interface RunOptions<T> {
  onSuccess?: (result: T) => void;
  /**
   * Called with the raw error when the action fails with a non-auth error.
   * Use `toUserMessage(err)` for generic display, or inspect `ApiError.statusCode`
   * for domain-specific messages (e.g. 409 duplicate, 403 business rule).
   * Not called when `isAuthError` is true — that case triggers signOut + redirect.
   */
  onError?: (err: unknown) => void;
  /** Destination after signOut when the session is stale. Defaults to '/login'. */
  callbackUrl?: string;
}

/**
 * Hook that wraps authenticated API calls with a single, structural auth-error handler.
 * On HTTP 401 it signs the user out and redirects to callbackUrl (stale session).
 * All other errors are forwarded to onError — never to signOut.
 * A transient network failure will NOT log the user out.
 */
export function useApiAction() {
  // Stable reference across renders — safe to include in useCallback/useEffect dep arrays.
  // signOut and isAuthError are module-level stable references.
  const run = useCallback(async function run<T>(
    action: () => Promise<T>,
    options: RunOptions<T> = {},
  ): Promise<void> {
    const { onSuccess, onError, callbackUrl = '/login' } = options;
    try {
      const result = await action();
      onSuccess?.(result);
    } catch (err) {
      if (isAuthError(err)) {
        await signOut({ callbackUrl });
        return;
      }
      onError?.(err);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { run };
}
