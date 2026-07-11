'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import { getCategories } from '@/lib/api/categorias';
import {
  createAdminSponsoredAd,
  updateAdminSponsoredAd,
  uploadSponsoredAdImage,
  type AdminSponsoredAd,
} from '@/lib/api/admin-sponsored-ads';
import type { Category } from '@/types';

interface Props {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = crear; con valor = editar ese patrocinado. */
  ad: AdminSponsoredAd | null;
  onSuccess: () => void;
}

/** yyyy-MM-ddThh:mm — formato que espera <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SponsoredAdFormDialog({ token, open, onOpenChange, ad, onSuccess }: Props) {
  const isEdit = ad != null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [order, setOrder] = useState(0);
  const [active, setActive] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    getCategories().then(setCategories).catch(() => setCategories([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (ad) {
      setImageUrl(ad.imageUrl);
      setTitle(ad.title);
      setDescription(ad.description);
      setTargetUrl(ad.targetUrl);
      setCategoryId(ad.categoryId);
      setOrder(ad.order);
      setActive(ad.active);
      setStartsAt(ad.startsAt ? toLocalInput(ad.startsAt) : '');
      setEndsAt(ad.endsAt ? toLocalInput(ad.endsAt) : '');
    } else {
      setImageUrl('');
      setTitle('');
      setDescription('');
      setTargetUrl('');
      setCategoryId('');
      setOrder(0);
      setActive(true);
      setStartsAt('');
      setEndsAt('');
    }
  }, [open, ad]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadSponsoredAdImage(token, file);
      setImageUrl(result.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al subir la imagen.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const startsAtIso = startsAt ? new Date(startsAt).toISOString() : undefined;
      const endsAtIso = endsAt ? new Date(endsAt).toISOString() : undefined;

      if (isEdit) {
        await updateAdminSponsoredAd(token, ad!.id, {
          imageUrl,
          title,
          description,
          targetUrl,
          categoryId,
          order,
          active,
          startsAt: startsAt ? startsAtIso : null,
          endsAt: endsAt ? endsAtIso : null,
        });
      } else {
        await createAdminSponsoredAd(token, {
          imageUrl,
          title,
          description,
          targetUrl,
          categoryId,
          order,
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
        });
      }
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar el patrocinado.');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = imageUrl !== '' && title !== '' && description !== '' && targetUrl !== '' && categoryId !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar patrocinado "${ad!.title}"` : 'Nuevo patrocinado'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Imagen</Label>
            <div className="mt-1 flex items-center gap-3">
              {imageUrl && (
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  <Image src={imageUrl} alt="" fill className="object-cover" sizes="64px" />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                data-testid="sponsored-ad-image-input"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="sponsored-title">Título</Label>
            <Input id="sponsored-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="sponsored-description">Descripción</Label>
            <Textarea
              id="sponsored-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="sponsored-target-url">Enlace externo</Label>
            <Input
              id="sponsored-target-url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://ejemplo.com/promo"
            />
          </div>

          <div>
            <Label htmlFor="sponsored-category">Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="sponsored-category">
                <SelectValue placeholder="Elige una categoría" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((root) => (
                  <SelectGroup key={root.id}>
                    <SelectLabel>{root.name}</SelectLabel>
                    <SelectItem value={root.id}>{root.name} (todas)</SelectItem>
                    {root.children?.map((child) => (
                      <SelectItem key={child.id} value={child.id}>
                        {child.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="sponsored-order">Orden (desempate entre varios activos)</Label>
            <Input
              id="sponsored-order"
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sponsored-starts-at">Empieza (opcional)</Label>
              <Input
                id="sponsored-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sponsored-ends-at">Termina (opcional)</Label>
              <Input
                id="sponsored-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="sponsored-active"
              checked={active}
              onCheckedChange={(checked) => setActive(checked === true)}
            />
            <Label htmlFor="sponsored-active" className="cursor-pointer">
              Activo
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy || uploading || !canSubmit}>
            {isEdit ? 'Guardar cambios' : 'Crear patrocinado'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
