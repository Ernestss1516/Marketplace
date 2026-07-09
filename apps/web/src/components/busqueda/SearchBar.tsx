'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SearchBar({ defaultValue = '' }: { defaultValue?: string }) {
  const [query, setQuery] = useState(defaultValue);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/busqueda?q=${encodeURIComponent(q)}` : '/busqueda');
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex gap-2 rounded-2xl border bg-background p-2 shadow-lg"
    >
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
