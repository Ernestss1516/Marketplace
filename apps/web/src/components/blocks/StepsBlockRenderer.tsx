import type { StepsBlock } from '@/types/blocks';
import { isSafeSrc } from '@/lib/image-domains';

export function StepsBlockRenderer({ block }: { block: StepsBlock }) {
  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      <ol className="space-y-6">
        {block.items.map((item, idx) => (
          <li key={idx} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{item.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              {item.image && isSafeSrc(item.image) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt={item.title} className="mt-3 w-full max-w-sm rounded-lg" />
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
