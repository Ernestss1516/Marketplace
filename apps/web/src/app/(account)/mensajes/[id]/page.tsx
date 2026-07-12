import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getConversation } from '@/lib/api/mensajes';
import { ApiError } from '@/lib/api/client';
import { ChatClient } from '@/components/mensajes/ChatClient';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata: Metadata = { title: 'Conversación' };

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [session, { id }] = await Promise.all([auth(), params]);
  if (!session?.user.accessToken) redirect(buildLoginUrl(`/mensajes/${id}`));

  let initialData;
  try {
    initialData = await getConversation(id, session.user.accessToken);
  } catch (err) {
    if (err instanceof ApiError && (err.statusCode === 404 || err.statusCode === 403)) {
      notFound();
    }
    throw err;
  }

  return (
    <ChatClient
      initialData={initialData}
      token={session.user.accessToken}
      userId={session.user.id}
    />
  );
}
