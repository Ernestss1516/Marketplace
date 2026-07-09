'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { LogOut, Heart, List } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationBell } from '@/components/notifications/NotificationBell';

interface Props {
  initialUnreadCount: number;
}

/** Right-side auth nav in the public Header — login link for anonymous visitors
 * (unchanged), bell + user menu for logged-in ones. Session comes from the
 * SessionProvider seeded server-side in the root layout, so there's no
 * loading flash on first paint. */
export function HeaderAuthNav({ initialUnreadCount }: Props) {
  const { data: session, status } = useSession();

  if (status !== 'authenticated') {
    return (
      <Link
        href="/login"
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        Iniciar sesión
      </Link>
    );
  }

  const u = session.user as { name?: string; email?: string };
  const name = u.name ?? u.email ?? 'Usuario';

  return (
    <div className="flex items-center gap-1">
      <NotificationBell initialUnreadCount={initialUnreadCount} />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {name.charAt(0).toUpperCase()}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href="/mis-anuncios">
              <List className="mr-2 h-4 w-4" />
              Mis anuncios
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href="/favoritos">
              <Heart className="mr-2 h-4 w-4" />
              Favoritos
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
