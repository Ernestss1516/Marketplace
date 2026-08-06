import type { HubBlock } from '@/types/blocks';
import { SmartLink } from '@/components/shared/SmartLink';

// Mismo criterio interno/externo que FooterItem: relativa ("/...") → <Link>;
// absoluta http/https → <a target="_blank" rel="noopener noreferrer">. Vive en
// components/shared/SmartLink, que no menciona ningún tipo de bloque y por eso
// lo comparten los dos motores (docs/diseno-portada.md §4.0). Aquí no se pasa
// `external`: se deja derivar del href, que es lo que este bloque hacía.
export function HubBlockRenderer({ block }: { block: HubBlock }) {
  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      <div className="grid gap-4 sm:grid-cols-2">
        {block.links.map((link, idx) => (
          <SmartLink
            key={idx}
            href={link.href}
            className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
          >
            <span className="font-medium">{link.label}</span>
            {link.description && (
              <span className="mt-1 block text-sm text-muted-foreground">{link.description}</span>
            )}
          </SmartLink>
        ))}
      </div>
    </div>
  );
}
