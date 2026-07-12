import type { ProfileBlock } from '@/types/blocks';
import { isSafeSrc } from '@/lib/image-domains';

export function ProfileBlockRenderer({ block }: { block: ProfileBlock }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {block.image && isSafeSrc(block.image.url) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.image.url}
          alt={block.image.alt}
          className="h-32 w-32 shrink-0 rounded-full object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        {block.name && <p className="mb-2 text-lg font-semibold">{block.name}</p>}
        <dl className="space-y-1">
          {block.attributes.map((attr, idx) => (
            <div key={idx} className="flex gap-2 text-sm">
              <dt className="shrink-0 font-medium text-muted-foreground">{attr.label}:</dt>
              <dd className="min-w-0 truncate">{attr.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
