/**
 * Unit tests for useApiAction hook.
 *
 * Key invariants verified:
 *   - HTTP 401 → signOut() called, onError NOT called
 *   - Other errors (network, 403, 500) → onError called, signOut NOT called
 *   - 403 is business rule → NOT treated as auth error
 *   - Successful action → onSuccess called, signOut NOT called
 */

import { renderHook, act } from '@testing-library/react';
import { useApiAction } from '../use-api-action';
import { ApiError } from '../client';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSignOut = jest.fn().mockResolvedValue(undefined);

jest.mock('next-auth/react', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function reject<T>(err: unknown): () => Promise<T> {
  return () => Promise.reject(err);
}

function resolve<T>(value: T): () => Promise<T> {
  return () => Promise.resolve(value);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useApiAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls signOut with callbackUrl on HTTP 401, never calls onError', async () => {
    const { result } = renderHook(() => useApiAction());
    const onError = jest.fn();
    const onSuccess = jest.fn();

    await act(async () => {
      await result.current.run(reject(new ApiError(401, 'Unauthorized')), {
        onSuccess,
        onError,
        callbackUrl: '/login?callbackUrl=%2Fplanes',
      });
    });

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login?callbackUrl=%2Fplanes' });
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('defaults callbackUrl to /login when not provided', async () => {
    const { result } = renderHook(() => useApiAction());

    await act(async () => {
      await result.current.run(reject(new ApiError(401, 'Unauthorized')));
    });

    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });

  it('calls onError with raw error on network failure, does NOT call signOut', async () => {
    const { result } = renderHook(() => useApiAction());
    const onError = jest.fn();
    const networkError = new TypeError('Failed to fetch');

    await act(async () => {
      await result.current.run(reject(networkError), { onError });
    });

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(networkError);
  });

  it('calls onError on HTTP 403 (business rule) — does NOT signOut', async () => {
    const { result } = renderHook(() => useApiAction());
    const onError = jest.fn();
    const forbidden = new ApiError(403, 'Forbidden');

    await act(async () => {
      await result.current.run(reject(forbidden), { onError });
    });

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(forbidden);
  });

  it('calls onError on HTTP 409 (duplicate), does NOT signOut', async () => {
    const { result } = renderHook(() => useApiAction());
    const onError = jest.fn();
    const conflict = new ApiError(409, 'Conflict');

    await act(async () => {
      await result.current.run(reject(conflict), { onError });
    });

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(conflict);
  });

  it('calls onSuccess with result, does not call signOut or onError', async () => {
    const { result } = renderHook(() => useApiAction());
    const onSuccess = jest.fn();
    const onError = jest.fn();
    const data = { checkoutUrl: 'https://checkout.stripe.com/test' };

    await act(async () => {
      await result.current.run(resolve(data), { onSuccess, onError });
    });

    expect(onSuccess).toHaveBeenCalledWith(data);
    expect(onError).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns a stable run reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useApiAction());
    const first = result.current.run;
    rerender();
    expect(result.current.run).toBe(first);
  });
});
