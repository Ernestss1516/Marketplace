import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getConversations } from '@/lib/api/mensajes';
import { BandejaMensajesClient } from '@/components/mensajes/BandejaMensajesClient';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata: Metadata = { title: 'Mensajes' };

export default async function MensajesPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mensajes'));

  const { items } = await getConversations(session.user.accessToken);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Mensajes</h1>
      <BandejaMensajesClient
        initialConversations={items}
        token={session.user.accessToken}
        userId={session.user.id}
      />
    </div>
  );
}
