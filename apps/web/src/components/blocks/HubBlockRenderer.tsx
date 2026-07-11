import Link from 'next/link';
import type { HubBlock } from '@/types/blocks';

// Mismo criterio interno/externo que FooterItem: relativa ("/...") → <Link>;
// absoluta http/https → <a target="_blank" rel="noopener noreferrer">.
function isExternalHref(href: string): boolean {
  return !href.startsWith('/');
}

export function HubBlockRenderer({ block }: { block: HubBlock }) {
  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      <div className="grid gap-4 sm:grid-cols-2">
        {block.links.map((link, idx) => {
          const external = isExternalHref(link.href);
          const content = (
            <>
              <span className="font-medium">{link.label}</span>
              {link.description && (
                <span className="mt-1 block text-sm text-muted-foreground">{link.description}</span>
              )}
            </>
          );
          const className = 'block rounded-lg border p-4 transition-colors hover:bg-muted/50';
          return external ? (
            <a key={idx} href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
              {content}
            </a>
          ) : (
            <Link key={idx} href={link.href} className={className}>
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
