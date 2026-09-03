import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { SellerRatingInline } from './listing-card-shared';

interface SellerCardProps {
  seller: {
    name: string;
    slug: string;
    avatarUrl?: string;
    trusted?: boolean;
    /** Escaparate RÁFAGA 4 — media VERIFICADA; null = "Nuevo". */
    ratingAverage?: number | null;
    ratingCount?: number;
  };
  publishedAt?: string;
}

export function SellerCard({ seller, publishedAt }: SellerCardProps) {
  const published = publishedAt
    ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(publishedAt),
      )
    : null;

  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Vendedor
      </p>
      <Link
        href={`/vendedor/${seller.slug}`}
        className="flex items-center gap-3 hover:underline"
      >
        <Avatar>
          <AvatarImage src={seller.avatarUrl} alt={seller.name} />
          <AvatarFallback>{seller.name[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{seller.name}</p>
          <SellerRatingInline average={seller.ratingAverage} count={seller.ratingCount} detailed />
          {published && (
            <p className="text-xs text-muted-foreground">Publicado el {published}</p>
          )}
        </div>
      </Link>
      {seller.trusted && (
        <Badge
          variant="outline"
          className="mt-3 gap-1 border-success-border bg-success text-success-foreground hover:bg-success"
          data-testid="seller-trusted-badge"
        >
          <BadgeCheck className="h-3 w-3" aria-hidden />
          Vendedor de confianza
        </Badge>
      )}
    </div>
  );
}
