'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { ListingImage } from '@/types';

export function ListingGallery({
  images,
  title,
}: {
  images: ListingImage[];
  title: string;
}) {
  const [selected, setSelected] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        Sin fotos
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <Image
          src={images[selected].url}
          alt={images[selected].alt ?? title}
          fill
          className="object-contain"
          sizes="(max-width: 768px) 100vw, 60vw"
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              aria-label={`Ver foto ${i + 1}`}
              className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded border-2 transition-colors ${
                i === selected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
              }`}
            >
              <Image
                src={img.url}
                alt={img.alt ?? `${title} — foto ${i + 1}`}
                fill
                className="object-cover"
                sizes="64px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
