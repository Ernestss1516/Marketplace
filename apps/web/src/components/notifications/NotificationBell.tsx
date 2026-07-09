'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApiAction } from '@/lib/api/use-api-action';
import {
  getMyNotifications,
  getUnreadNotificationsCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notificaciones';
import { getNotificationContent } from './notification-content';
import type { NotificationItem } from '@/types';

const RECENT_LIMIT = 8;

interface Props {
  /** SSR-fetched count for the first paint — avoids a badge flash while the client fetch resolves. */
  initialUnreadCount: number;
}

export function NotificationBell({ initialUnreadCount }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const token = session?.user.accessToken;
  const pathname = usePathname();

  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);

  // Skip the first run — initialUnreadCount already covers the page's first paint.
  // Client-side navigations between pages don't re-run the server layout, so this
  // keeps the badge fresh as the user browses without an interval poll.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (!token) return;
    run(() => getUnreadNotificationsCount(token), {
      onSuccess: ({ count }) => setUnreadCount(count),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, token]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open || !token) return;
      setLoadingItems(true);
      run(() => getMyNotifications(token, 1, RECENT_LIMIT), {
        onSuccess: (data) => {
          setItems(data.items);
          setLoadingItems(false);
        },
        onError: () => setLoadingItems(false),
      });
    },
    [token, run],
  );

  function handleItemClick(n: NotificationItem) {
    if (n.read || !token) return;
    setItems((prev) => prev?.map((i) => (i.id === n.id ? { ...i, read: true } : i)) ?? null);
    setUnreadCount((c) => Math.max(0, c - 1));
    run(() => markNotificationRead(n.id, token));
  }

  function handleMarkAllRead() {
    if (!token) return;
    setItems((prev) => prev?.map((i) => ({ ...i, read: true })) ?? null);
    setUnreadCount(0);
    run(() => markAllNotificationsRead(token));
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificaciones">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notificaciones</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs text-primary hover:underline"
            >
              Marcar todas como leídas
            </button>
          )}
        </div>

        {loadingItems && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">Cargando…</p>
        )}

        {!loadingItems && items !== null && items.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            No tienes notificaciones.
          </p>
        )}

        {!loadingItems &&
          items?.map((n) => {
            const { text, href } = getNotificationContent(n);
            return (
              <DropdownMenuItem key={n.id} asChild className="cursor-pointer whitespace-normal">
                <Link href={href} onClick={() => handleItemClick(n)}>
                  <span className={n.read ? 'text-muted-foreground' : 'font-medium'}>{text}</span>
                </Link>
              </DropdownMenuItem>
            );
          })}

        <DropdownMenuItem asChild className="cursor-pointer justify-center text-primary">
          <Link href="/notificaciones">Ver todas</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
