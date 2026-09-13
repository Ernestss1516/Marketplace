import Link from 'next/link';
import Image from 'next/image';
import { categoryPath } from '@/lib/category-url';
import type { Category } from '@/types';

export function CategoryGrid({ categories }: { categories: Category[] }) {
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 md:grid-cols-6">
      {categories.map((cat) => (
        <Link
          key={cat.id}
          href={categoryPath(cat)}
          // ESCAPARATE C — el gesto compartido. Antes: `transition-all` con medio píxel
          // de levantamiento y `shadow-sm`. `transition-all` además animaba el color del
          // borde y cualquier otra propiedad que cambiara, que es más de lo que hace
          // falta y más de lo que conviene pintar.
          className="tarjeta-levanta flex w-24 shrink-0 snap-start flex-col items-center gap-2 rounded-xl border p-4 text-center hover:border-primary/40 sm:w-auto"
        >
          {cat.iconUrl ? (
            <div className="relative h-12 w-12">
              <Image
                src={cat.iconUrl}
                alt={cat.name}
                fill
                className="object-contain"
                sizes="48px"
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              {cat.name[0]}
            </div>
          )}
          <span className="text-xs font-medium leading-tight">{cat.name}</span>
        </Link>
      ))}
    </div>
  );
}
