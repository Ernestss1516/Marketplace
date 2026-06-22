'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateMe } from '@/lib/api/usuarios';
import type { User } from '@/types';

type Status = 'idle' | 'saving' | 'success' | 'error';

interface Props {
  initialUser: User;
  token: string;
}

export function PerfilForm({ initialUser, token }: Props) {
  const [fields, setFields] = useState({
    name: initialUser.name,
    phone: initialUser.phone ?? '',
    bio: initialUser.bio ?? '',
    city: initialUser.city ?? '',
    province: initialUser.province ?? '',
    postalCode: initialUser.postalCode ?? '',
  });
  const [status, setStatus] = useState<Status>('idle');
  const [isPending, startTransition] = useTransition();

  const isSaving = isPending || status === 'saving';

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    if (status !== 'idle') setStatus('idle');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    startTransition(async () => {
      try {
        await updateMe(
          {
            name: fields.name.trim(),
            phone: fields.phone.trim() || undefined,
            bio: fields.bio.trim() || undefined,
            city: fields.city.trim() || undefined,
            province: fields.province.trim() || undefined,
            postalCode: fields.postalCode.trim() || undefined,
          },
          token,
        );
        setStatus('success');
      } catch {
        setStatus('error');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            value={fields.name}
            onChange={handleChange}
            required
            maxLength={100}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            value={fields.phone}
            onChange={handleChange}
            maxLength={20}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="city">Ciudad</Label>
          <Input
            id="city"
            name="city"
            value={fields.city}
            onChange={handleChange}
            maxLength={100}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="province">Provincia</Label>
          <Input
            id="province"
            name="province"
            value={fields.province}
            onChange={handleChange}
            maxLength={100}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="postalCode">Código postal</Label>
          <Input
            id="postalCode"
            name="postalCode"
            value={fields.postalCode}
            onChange={handleChange}
            maxLength={10}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bio">Sobre mí</Label>
        <Textarea
          id="bio"
          name="bio"
          value={fields.bio}
          onChange={handleChange}
          rows={4}
          maxLength={500}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">{fields.bio.length}/500</p>
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios
        </Button>

        {status === 'success' && (
          <p className="text-sm text-green-600">Perfil actualizado correctamente.</p>
        )}
        {status === 'error' && (
          <p className="text-sm text-destructive">Error al guardar. Inténtalo de nuevo.</p>
        )}
      </div>
    </form>
  );
}
