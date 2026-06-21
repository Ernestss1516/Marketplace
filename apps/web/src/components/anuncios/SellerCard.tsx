import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface SellerCardProps {
  seller: { name: string; slug: string; avatarUrl?: string };
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
          {published && (
            <p className="text-xs text-muted-foreground">Publicado el {published}</p>
          )}
        </div>
      </Link>
    </div>
  );
}
