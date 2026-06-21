'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { startConversation } from '@/lib/api/mensajes';

interface Props {
  listingId: string;
  listingSlug: string;
}

export function ContactButton({ listingId, listingSlug }: Props) {
  const { data: session } = useSession();
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenContact() {
    if (!session) {
      router.push(`/login?redirect=/anuncio/${listingSlug}`);
      return;
    }
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setMessage('');
    setError(null);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user.accessToken || !message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const conv = await startConversation(listingId, message.trim(), session.user.accessToken);
      router.push(`/mensajes/${conv.id}`);
    } catch {
      setError('No se pudo enviar el mensaje. Inténtalo de nuevo.');
      setSending(false);
    }
  }

  // Shown when email is not verified
  const unverifiedNotice = (
    <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <p>Verifica tu email antes de enviar mensajes.</p>
      <Link href="/verificar-email" className="mt-1 inline-block font-medium underline">
        Verificar ahora
      </Link>
      <Button
        variant="ghost"
        size="sm"
        className="ml-2"
        onClick={handleCancel}
      >
        Cancelar
      </Button>
    </div>
  );

  // Inline contact form
  const contactForm = (
    <form onSubmit={handleSend} className="space-y-3">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Escribe tu mensaje al vendedor…"
        rows={4}
        disabled={sending}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        className="resize-none"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          className="flex-1"
          disabled={sending || !message.trim()}
        >
          {sending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <MessageCircle className="mr-2 h-4 w-4" />
          )}
          Enviar mensaje
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleCancel}
          disabled={sending}
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );

  const contactTrigger = (
    <Button size="lg" className="w-full" onClick={handleOpenContact}>
      <MessageCircle className="mr-2 h-5 w-5" />
      Contactar con el vendedor
    </Button>
  );

  function renderContent() {
    if (!showForm) return contactTrigger;
    if (!session?.user.emailVerified) return unverifiedNotice;
    return contactForm;
  }

  return (
    <>
      {/* Fixed bottom bar — mobile only */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background p-4 md:hidden">
        {renderContent()}
      </div>
      {/* Inline sidebar — desktop only */}
      <div className="hidden space-y-3 md:block">{renderContent()}</div>
    </>
  );
}
