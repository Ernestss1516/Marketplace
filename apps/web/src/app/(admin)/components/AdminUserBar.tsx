'use client';

import { signOut, useSession } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AdminUserBar() {
  const { data: session } = useSession();
  const u = session?.user as { name?: string; email?: string; role?: string } | undefined;
  const name = u?.name ?? u?.email ?? 'Admin';
  // Esta barra la comparten ADMIN/MODERATOR/EDITOR — solo ADMIN está
  // bloqueado del /login público (y solo ADMIN puede entrar por
  // /admin/login); cada rol debe volver a SU puerta válida al desloguearse,
  // o el otro grupo queda en un callejón sin salida.
  const loginPath = u?.role === 'ADMIN' ? '/admin/login' : '/login';

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold select-none">
        {name.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm font-medium truncate max-w-[160px]">{name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => signOut({ callbackUrl: loginPath })}
        title="Cerrar sesión"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
