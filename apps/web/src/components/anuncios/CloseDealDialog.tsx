'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader2, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useApiAction } from '@/lib/api/use-api-action';
import { toUserMessage } from '@/lib/api/client';
import { closeDeal, getListingContacts } from '@/lib/api/anuncios';
import { searchUsers } from '@/lib/api/usuarios';
import type { CloseDealResult, ListingContact, ListingType, PersonStub } from '@/types';

interface Props {
  listing: { id: string; type: ListingType };
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: CloseDealResult) => void;
}

/**
 * Ciclo de vida RÁFAGA 1 — selector de comprador/cliente para cerrar un Deal.
 * Ramifica por tipo SOLO en texto/copy: el backend es quien decide qué pasa
 * con el status (PRODUCTO → SOLD, SERVICIO → sigue ACTIVE) y quién exige
 * buyerId obligatorio (SERVICIO). Contactos del anuncio como quick-pick;
 * buscador libre debajo para el caso "cerrado por teléfono/en persona".
 */
export function CloseDealDialog({ listing, token, open, onOpenChange, onSuccess }: Props) {
  const { run } = useApiAction();
  const isService = listing.type === 'SERVICE';

  const [contacts, setContacts] = useState<ListingContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PersonStub[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PersonStub | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setQuery('');
    setSearchResults([]);
    setError(null);
    setLoadingContacts(true);
    getListingContacts(listing.id, token)
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [open, listing.id, token]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      searchUsers(trimmed, token)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, token]);

  async function handleSubmit(withoutBuyer: boolean) {
    setBusy(true);
    setError(null);
    await run(() => closeDeal(listing.id, withoutBuyer ? undefined : selected?.id, token), {
      onSuccess: (result) => {
        onOpenChange(false);
        onSuccess(result);
      },
      onError: (err) => setError(toUserMessage(err)),
    });
    setBusy(false);
  }

  const contactIds = new Set(contacts.map((c) => c.id));
  const extraResults = searchResults.filter((r) => !contactIds.has(r.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isService ? 'Registrar cliente' : 'Marcar vendido'}</DialogTitle>
          <DialogDescription>
            {isService
              ? 'El anuncio seguirá publicado — puedes repetir esto con más clientes.'
              : 'El anuncio pasará a vendido y desaparecerá del catálogo.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">
              {isService ? '¿Quién fue el cliente?' : '¿A quién se lo vendiste?'}
            </p>

            {loadingContacts ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : contacts.length > 0 ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
                {contacts.map((c) => (
                  <PersonRow
                    key={c.id}
                    person={c}
                    selected={selected?.id === c.id}
                    onSelect={() => setSelected(c)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nadie te ha contactado sobre este anuncio todavía.
              </p>
            )}
          </div>

          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar otro usuario por nombre…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            {searching && <p className="mt-1 text-xs text-muted-foreground">Buscando…</p>}
            {extraResults.length > 0 && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
                {extraResults.map((r) => (
                  <PersonRow
                    key={r.id}
                    person={r}
                    selected={selected?.id === r.id}
                    onSelect={() => setSelected(r)}
                  />
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => handleSubmit(false)} disabled={busy || !selected}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              {isService ? 'Registrar cliente' : 'Marcar vendido'}
            </Button>
          </div>
          {!isService && (
            <Button
              variant="ghost"
              size="sm"
              className="self-end text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => handleSubmit(true)}
            >
              Marcar vendido sin comprador registrado
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonRow({
  person,
  selected,
  onSelect,
}: {
  person: PersonStub;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-muted ${
        selected ? 'bg-muted ring-1 ring-primary' : ''
      }`}
    >
      <Avatar className="h-7 w-7">
        <AvatarImage src={person.avatarUrl} alt={person.name} />
        <AvatarFallback className="text-xs">{person.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate">{person.name}</span>
      {selected && <CheckCircle className="ml-auto h-4 w-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
