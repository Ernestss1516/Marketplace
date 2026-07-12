'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';

/** Client-side signOut (matches HeaderAuthNav/AdminUserBar) so it does a full
 * browser navigation to '/' — a server-action signOut + redirect() only does a
 * soft client transition, which can leave the Header's Router Cache entry for
 * '/' stale (still showing the logged-in state) until a hard reload. */
export function SignOutButton() {
  return (
    <Button
      type="button"
      variant="destructive"
      onClick={() => signOut({ callbackUrl: '/' })}
    >
      Cerrar sesión
    </Button>
  );
}
