'use client';

import { useCallback } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { isAuthError } from './client';

/** Mensaje fijo, o derivado del resultado/error de la acción. */
type Message<T> = string | ((value: T) => string | null | undefined);

function resolveMessage<T>(message: Message<T> | undefined, value: T): string | null {
  if (message === undefined) return null;
  const text = typeof message === 'function' ? message(value) : message;
  return text ? text : null;
}

interface RunOptions<T> {
  onSuccess?: (result: T) => void;
  /**
   * Called with the raw error when the action fails with a non-auth error.
   * Use `toUserMessage(err)` for generic display, or inspect `ApiError.statusCode`
   * for domain-specific messages (e.g. 409 duplicate, 403 business rule).
   * Not called when `isAuthError` is true — that case triggers signOut + redirect.
   */
  onError?: (err: unknown) => void;
  /**
   * UXV.3 (M6) — CANAL DE ÉXITO. Texto (o función del resultado) que se anuncia con un
   * toast al resolver. Devolver `null`/`undefined` desde la función = esta vez no se
   * avisa, útil cuando el mismo botón cubre casos que merecen mensaje y casos que no.
   *
   * Este es el cableado que evita que cada pantalla vuelva a inventarse su confirmación:
   * antes de UXV.3 este hook SOLO tenía canal de error, y de ahí salían las tres
   * pantallas que terminaban en silencio (M5, M7 y la mitad de A7).
   */
  successMessage?: Message<T>;
  /**
   * Toast de error. **Opcional y NO por defecto**, a propósito: según la regla de reparto
   * del diseño (FEEDBACK-D2), el error de una acción con contexto —«saldo insuficiente» y
   * su enlace para comprar— se queda INLINE, donde está el botón, porque lleva una acción
   * de recuperación anclada. El toast es para el error suelto que no tiene dónde vivir.
   * `onError` sigue llamándose igual, se pase esto o no.
   */
  errorMessage?: Message<unknown>;
  /** Destination after signOut when the session is stale. Defaults to '/login'. */
  callbackUrl?: string;
}

/**
 * Hook that wraps authenticated API calls with a single, structural auth-error handler.
 * On HTTP 401 it signs the user out and redirects to callbackUrl (stale session).
 * All other errors are forwarded to onError — never to signOut.
 * A transient network failure will NOT log the user out.
 *
 * UXV.3 — además del manejo de auth, es el punto por el que pasa el feedback de éxito
 * (`successMessage`). El comportamiento sin las opciones nuevas es EXACTAMENTE el de
 * antes: quien no las pasa no ve ningún toast.
 */
export function useApiAction() {
  // Stable reference across renders — safe to include in useCallback/useEffect dep arrays.
  // signOut and isAuthError are module-level stable references.
  const run = useCallback(async function run<T>(
    action: () => Promise<T>,
    options: RunOptions<T> = {},
  ): Promise<void> {
    const { onSuccess, onError, successMessage, errorMessage, callbackUrl = '/login' } = options;
    try {
      const result = await action();
      // El toast ANTES de onSuccess: onSuccess suele cerrar un diálogo o navegar, y el
      // aviso tiene que haber salido ya cuando eso ocurra.
      const okText = resolveMessage(successMessage, result);
      if (okText) toast.success(okText);
      onSuccess?.(result);
    } catch (err) {
      if (isAuthError(err)) {
        await signOut({ callbackUrl });
        return;
      }
      const errText = resolveMessage(errorMessage, err);
      if (errText) toast.error(errText);
      onError?.(err);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { run };
}
