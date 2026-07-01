'use client';

import { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Municipio {
  name: string;
  province: string;
}

export interface MunicipioAutocompleteProps {
  id?: string;
  value: string;
  /**
   * Llamado en cada keystroke con el texto libre (province = undefined).
   * Llamado al seleccionar del desplegable con name canónico + province.
   */
  onChange: (city: string, province?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'data-testid'?: string;
}

/** Elimina acentos y convierte a minúsculas para comparación tolerante. */
function normalize(str: string): string {
  // NFD splits accented chars (é → e + U+0301); then remove combining diacritical marks U+0300-U+036F.
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const MAX_RESULTS = 8;
// Only start filtering when the user has typed at least 2 characters.
const MIN_QUERY_LENGTH = 2;

export function MunicipioAutocomplete({
  id,
  value,
  onChange,
  placeholder = 'Buscar municipio…',
  disabled,
  className,
  'aria-invalid': ariaInvalid,
  'data-testid': dataTestId,
}: MunicipioAutocompleteProps) {
  const [municipios, setMunicipios] = useState<Municipio[] | null>(null);
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Sync prop → local input when the parent changes the value (e.g. prefill).
  useEffect(() => {
    setInputVal(value);
  }, [value]);

  const q = normalize(inputVal);
  const suggestions =
    q.length >= MIN_QUERY_LENGTH && municipios !== null
      ? municipios
          .filter((m) => normalize(m.name).includes(q))
          .sort((a, b) => {
            const na = normalize(a.name);
            const nb = normalize(b.name);
            const aStarts = na.startsWith(q);
            const bStarts = nb.startsWith(q);
            // 1st: startsWith before includes-only.
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            // 2nd (tie-break within same group): shorter name = tighter match first.
            return na.length - nb.length;
          })
          .slice(0, MAX_RESULTS)
      : [];

  async function loadDataset() {
    if (municipios !== null) return;
    try {
      const res = await fetch('/data/municipios.json');
      const data: Municipio[] = await res.json();
      setMunicipios(data);
    } catch {
      // Graceful degradation: the field still works as free text.
      setMunicipios([]);
    }
  }

  function handleSelect(m: Municipio) {
    setInputVal(m.name);
    onChange(m.name, m.province);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInputVal(val);
    onChange(val); // free text — province untouched in parent
    setActiveIndex(-1);
    if (val.length >= MIN_QUERY_LENGTH) {
      void loadDataset();
      setOpen(true);
    } else {
      setOpen(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && inputVal.length >= MIN_QUERY_LENGTH) {
        void loadDataset();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? -1 : i - 1));
        break;
      case 'Enter':
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          e.preventDefault();
          handleSelect(suggestions[activeIndex]);
        }
        break;
      case 'Escape':
        setOpen(false);
        setActiveIndex(-1);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  // Close when the user clicks outside the container.
  useEffect(() => {
    if (!open) return;
    function handler(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  const activeOptionId =
    activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined;

  const inputClass = cn(
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-8',
    'text-base ring-offset-background placeholder:text-muted-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
    ariaInvalid && 'border-destructive',
    className,
  );

  return (
    <div ref={containerRef} className="relative" data-testid={dataTestId}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-invalid={ariaInvalid}
        autoComplete="off"
        value={inputVal}
        onChange={handleInputChange}
        onFocus={() => {
          if (inputVal.length >= MIN_QUERY_LENGTH) {
            void loadDataset();
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClass}
      />
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {suggestions.map((m, i) => (
            <li
              key={`${m.name}-${m.province}`}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                'flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm',
                i === activeIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
              onPointerDown={(e) => {
                // preventDefault prevents the input from losing focus before the click registers.
                e.preventDefault();
                handleSelect(m);
              }}
            >
              <span className="font-medium">{m.name}</span>
              <span className="text-xs text-muted-foreground">{m.province}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
