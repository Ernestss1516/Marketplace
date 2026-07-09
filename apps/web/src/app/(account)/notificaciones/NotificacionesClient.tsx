'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/api/use-api-action';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/api/notificaciones';
import { getNotificationContent } from '@/components/notifications/notification-content';
import { formatDate } from '@/lib/utils';
import type { NotificationItem } from '@/types';

interface Props {
  initialItems: NotificationItem[];
  totalInitial: number;
  page: number;
  pages: number;
}

export function NotificacionesClient({ initialItems, totalInitial, page, pages }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const token = session?.user.accessToken;

  const [items, setItems] = useState(initialItems);
  const unreadCount = items.filter((i) => !i.read).length;

  function handleItemClick(n: NotificationItem) {
    if (n.read || !token) return;
    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
    run(() => markNotificationRead(n.id, token), {
      onError: () => setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: false } : i))),
    });
  }

  function handleMarkAllRead() {
    if (!token) return;
    const previous = items;
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    run(() => markAllNotificationsRead(token), {
      onError: () => setItems(previous),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {totalInitial} {totalInitial === 1 ? 'notificación' : 'notificaciones'}
        </p>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            Marcar todas como leídas
          </Button>
        )}
      </div>

      <ul className="divide-y rounded-md border">
        {items.map((n) => {
          const { text, href } = getNotificationContent(n);
          return (
            <li key={n.id}>
              <Link
                href={href}
                onClick={() => handleItemClick(n)}
                className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted"
              >
                <span className={n.read ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>
                  {text}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(n.createdAt)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {page > 1 && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/notificaciones?page=${page - 1}`}>Anterior</Link>
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          {page < pages && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/notificaciones?page=${page + 1}`}>Siguiente</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
