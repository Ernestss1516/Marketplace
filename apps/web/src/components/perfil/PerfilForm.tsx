'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MunicipioAutocomplete } from '@/components/municipio/MunicipioAutocomplete';
import { uploadAvatar } from '@/lib/api/media';
import { updateMe } from '@/lib/api/usuarios';
import type { User } from '@/types';

type Status = 'idle' | 'saving' | 'success' | 'error';
type AvatarStatus = 'idle' | 'uploading' | 'error';

interface Props {
  initialUser: User;
  token: string;
}

export function PerfilForm({ initialUser, token }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState({
    name: initialUser.name,
    phone: initialUser.phone ?? '',
    bio: initialUser.bio ?? '',
    city: initialUser.city ?? '',
    province: initialUser.province ?? '',
    postalCode: initialUser.postalCode ?? '',
    avatarUrl: initialUser.avatarUrl ?? '',
  });
  const [status, setStatus] = useState<Status>('idle');
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>('idle');
  const [isPending, startTransition] = useTransition();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const isSaving = isPending || status === 'saving' || avatarStatus === 'uploading';

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    if (status !== 'idle') setStatus('idle');
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const previewUrl = URL.createObjectURL(file);
    const previousUrl = fields.avatarUrl;
    setFields((prev) => ({ ...prev, avatarUrl: previewUrl }));
    setAvatarStatus('uploading');

    try {
      const { url } = await uploadAvatar(file, token);
      URL.revokeObjectURL(previewUrl);
      setFields((prev) => ({ ...prev, avatarUrl: url }));
      setAvatarStatus('idle');
    } catch {
      URL.revokeObjectURL(previewUrl);
      setFields((prev) => ({ ...prev, avatarUrl: previousUrl }));
      setAvatarStatus('error');
    }
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
            avatarUrl: fields.avatarUrl || undefined,
          },
          token,
        );
        setStatus('success');
        router.refresh();
      } catch {
        setStatus('error');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar className="h-20 w-20 text-2xl" data-testid="perfil-avatar">
            <AvatarImage src={fields.avatarUrl || undefined} alt={fields.name} />
            <AvatarFallback>{fields.name[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
          {avatarStatus === 'uploading' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            </div>
          )}
        </div>
        <div className="space-y-1">
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            data-testid="avatar-input"
            onChange={handleAvatarChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarStatus === 'uploading'}
          >
            <Camera className="mr-2 h-4 w-4" />
            Cambiar foto
          </Button>
          {avatarStatus === 'error' && (
            <p className="text-xs text-destructive">Error al subir la imagen. Inténtalo de nuevo.</p>
          )}
        </div>
      </div>

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
          <MunicipioAutocomplete
            id="city"
            value={fields.city}
            placeholder="Buscar municipio…"
            data-testid="perfil-city-autocomplete"
            onChange={(city, province) => {
              setFields((prev) => ({
                ...prev,
                city,
                ...(province !== undefined && { province }),
              }));
              if (status !== 'idle') setStatus('idle');
            }}
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
            placeholder="Se rellena al seleccionar municipio"
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
