'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Send, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  url: string;
  title: string;
}

export function ShareButton({ url, title }: Props) {
  const [copied, setCopied] = useState(false);
  // Empieza en false (igual en servidor y cliente) para no desajustar la
  // hidratación — navigator no existe en SSR. Se corrige tras montar, así
  // que en móvil el botón nativo aparece con un parpadeo mínimo.
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  async function handleNativeShare() {
    try {
      await navigator.share({ title, url });
    } catch {
      // Usuario canceló el share nativo — no es un error a mostrar.
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (canNativeShare) {
    return (
      <Button variant="outline" size="lg" className="w-full" onClick={handleNativeShare}>
        <Share2 className="mr-2 h-5 w-5" />
        Compartir
      </Button>
    );
  }

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
  const telegramUrl = `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`;
  const mailUrl = `mailto:?subject=${encodedTitle}&body=${encodedUrl}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="w-full">
          <Share2 className="mr-2 h-5 w-5" />
          Compartir
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* preventDefault: Radix cierra el menú al seleccionar un item por
            defecto, lo que desmontaría este texto antes de que se vea — el
            feedback "Enlace copiado" necesita el menú abierto para ser visible. */}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void handleCopy();
          }}
        >
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? 'Enlace copiado' : 'Copiar enlace'}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" />
            WhatsApp
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={telegramUrl} target="_blank" rel="noopener noreferrer">
            <Send className="mr-2 h-4 w-4" />
            Telegram
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={mailUrl}>
            <Mail className="mr-2 h-4 w-4" />
            Email
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
