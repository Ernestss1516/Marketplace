'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { MessageCircle } from 'lucide-react';

export function ContactButton({
  listingSlug,
}: {
  listingSlug: string;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  function handleContact() {
    if (!session) {
      router.push(`/login?redirect=/anuncio/${listingSlug}`);
    } else {
      router.push('/mensajes');
    }
  }

  return (
    <>
      {/* Fixed bottom bar — mobile only */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background p-4 md:hidden">
        <Button size="lg" className="w-full" onClick={handleContact}>
          <MessageCircle className="mr-2 h-5 w-5" />
          Contactar con el vendedor
        </Button>
      </div>
      {/* Inline — desktop only */}
      <div className="hidden md:block">
        <Button size="lg" className="w-full" onClick={handleContact}>
          <MessageCircle className="mr-2 h-5 w-5" />
          Contactar con el vendedor
        </Button>
      </div>
    </>
  );
}
