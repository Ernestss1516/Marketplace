import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getConversations } from '@/lib/api/mensajes';
import { buildLoginUrl } from '@/lib/auth/callback-url';
import { MensajesShell } from '@/components/mensajes/MensajesShell';

export const metadata: Metadata = { title: 'Mensajes' };

/**
 * Dueño de la conexión WebSocket compartida y de la lista de conversaciones
 * para toda la sección /mensajes — al ser un layout, Next.js NO lo remonta al
 * navegar entre /mensajes y /mensajes/[id], así que ninguno de los dos
 * sobrevive de forma manual: es una garantía estructural del framework.
 */
export default async function MensajesLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mensajes'));

  const { items } = await getConversations(session.user.accessToken);

  return (
    <MensajesShell
      initialConversations={items}
      token={session.user.accessToken}
      userId={session.user.id}
    >
      {children}
    </MensajesShell>
  );
}
