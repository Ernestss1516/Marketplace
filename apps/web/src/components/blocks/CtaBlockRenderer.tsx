import Link from 'next/link';
import type { CtaBlock, CtaStyle } from '@/types/blocks';
import { Button } from '@/components/ui/button';

const STYLE_TO_VARIANT: Record<CtaStyle, 'default' | 'secondary' | 'outline'> = {
  primary: 'default',
  secondary: 'secondary',
  outline: 'outline',
};

function isExternalHref(href: string): boolean {
  return !href.startsWith('/');
}

export function CtaBlockRenderer({ block }: { block: CtaBlock }) {
  const variant = STYLE_TO_VARIANT[block.style ?? 'primary'];
  const external = isExternalHref(block.href);

  return (
    <div className="flex justify-center">
      <Button asChild variant={variant} size="lg">
        {external ? (
          <a href={block.href} target="_blank" rel="noopener noreferrer">
            {block.label}
          </a>
        ) : (
          <Link href={block.href}>{block.label}</Link>
        )}
      </Button>
    </div>
  );
}
