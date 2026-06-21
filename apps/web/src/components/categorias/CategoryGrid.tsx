import Link from 'next/link';
import Image from 'next/image';
import type { Category } from '@/types';

export function CategoryGrid({ categories }: { categories: Category[] }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {categories.map((cat) => (
        <Link
          key={cat.id}
          href={`/${cat.slug}`}
          className="flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors hover:bg-accent"
        >
          {cat.iconUrl ? (
            <div className="relative h-10 w-10">
              <Image
                src={cat.iconUrl}
                alt={cat.name}
                fill
                className="object-contain"
                sizes="40px"
              />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              {cat.name[0]}
            </div>
          )}
          <span className="text-xs font-medium leading-tight">{cat.name}</span>
        </Link>
      ))}
    </div>
  );
}
