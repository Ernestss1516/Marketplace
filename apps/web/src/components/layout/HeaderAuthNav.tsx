'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { LogOut, Heart, List } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  avatarUrl?: string;
}

/** Right-side auth nav in the public Header — login link for anonymous visitors
 * (unchanged), bell + user menu for logged-in ones. Session comes from the
 * SessionProvider seeded server-side in the root layout, so there's no
 * loading flash on first paint. `avatarUrl` is fetched fresh by the server
 * Header on every render (not carried in the NextAuth session), so it stays
 * in sync after a profile update without needing to sign out/in. */
export function HeaderAuthNav({ initialUnreadCount, avatarUrl }: Props) {
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
        <DropdownMenuTrigger>
          <Avatar className="h-8 w-8 text-sm">
            <AvatarImage src={avatarUrl} alt={name} />
            <AvatarFallback className="bg-primary font-semibold text-primary-foreground">
              {name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
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
            onClick={() => signOut({ callbackUrl: '/' })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
