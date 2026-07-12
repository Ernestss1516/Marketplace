'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { buildLoginUrl } from '@/lib/auth/callback-url';

/**
 * Mecanismo único de "requiere login" para Client Components (RÁFAGA 4,
 * Nivel 1 — vuelve a la página, no retoma la acción). `loginUrl` apunta
 * siempre a la página actual; `requireAuth()` redirige ahí si no hay sesión
 * y devuelve `false` para que el llamante corte la acción.
 */
export function useRequireAuth() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const loginUrl = buildLoginUrl(pathname);

  function requireAuth(): boolean {
    if (session?.user.accessToken) return true;
    router.push(loginUrl);
    return false;
  }

  return { isAuthenticated: !!session?.user.accessToken, requireAuth, loginUrl };
}
