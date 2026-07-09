'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PROVINCIAS } from '@/lib/provincias';
import type { Category } from '@/types';

interface SearchBarProps {
  defaultValue?: string;
  /** Categorías top-level para el selector — pasadas por el llamador (ya cargadas server-side), sin query propia. */
  categories?: Category[];
}

export function SearchBar({ defaultValue = '', categories = [] }: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue);
  const [category, setCategory] = useState('');
  const [province, setProvince] = useState('');
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    const q = query.trim();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (province) params.set('province', province);
    const qs = params.toString();
    router.push(qs ? `/busqueda?${qs}` : '/busqueda');
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-2xl border bg-background p-2 shadow-lg md:flex-row md:items-stretch md:gap-0"
    >
      {categories.length > 0 && (
        <div className="border-b md:w-48 md:shrink-0 md:border-b-0 md:border-r">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Categoría"
            className="h-12 w-full rounded-xl bg-transparent px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-full md:text-base"
          >
            <option value="">Categoría</option>
            {categories.map((cat) =>
              cat.children && cat.children.length > 0 ? (
                <optgroup key={cat.slug} label={cat.name}>
                  <option value={cat.slug}>Todo en {cat.name}</option>
                  {cat.children.map((child) => (
                    <option key={child.slug} value={child.slug}>{child.name}</option>
                  ))}
                </optgroup>
              ) : (
                <option key={cat.slug} value={cat.slug}>{cat.name}</option>
              ),
            )}
          </select>
        </div>
      )}

      <div className="border-b md:w-44 md:shrink-0 md:border-b-0 md:border-r">
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          aria-label="Provincia"
          className="h-12 w-full rounded-xl bg-transparent px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-full md:text-base"
        >
          <option value="">Toda España</option>
          {PROVINCIAS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="¿Qué estás buscando?"
          className="h-14 w-full rounded-xl border-0 bg-transparent pl-12 pr-4 text-lg ring-offset-background placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-16 md:text-xl"
        />
      </div>
      <Button type="submit" size="lg" className="h-14 rounded-xl px-6 text-base md:h-16 md:px-8 md:text-lg">
        Buscar
      </Button>
    </form>
  );
}
