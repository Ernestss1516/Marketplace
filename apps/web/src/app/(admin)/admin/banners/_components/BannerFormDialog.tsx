'use client';

import { useEffect, useState } from 'react';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import type { BannerPlacement, BannerVariant } from '@/lib/api/banners';
import {
  createAdminBanner,
  updateAdminBanner,
  type AdminBanner,
} from '@/lib/api/admin-banners';

interface Props {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = crear; con valor = editar ese banner. */
  banner: AdminBanner | null;
  onSuccess: () => void;
}

const PLACEMENT_OPTIONS: { value: BannerPlacement; label: string }[] = [
  { value: 'HOME', label: 'Home' },
  { value: 'MIS_ANUNCIOS', label: 'Mis anuncios' },
];

/** yyyy-MM-ddThh:mm — formato que espera <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BannerFormDialog({ token, open, onOpenChange, banner, onSuccess }: Props) {
  const isEdit = banner != null;

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [placements, setPlacements] = useState<BannerPlacement[]>([]);
  const [variant, setVariant] = useState<BannerVariant>('INFO');
  const [shareable, setShareable] = useState(false);
  const [shareText, setShareText] = useState('');
  const [active, setActive] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (banner) {
      setTitle(banner.title);
      setText(banner.text);
      setLinkUrl(banner.linkUrl ?? '');
      setLinkText(banner.linkText ?? '');
      setPlacements(banner.placements);
      setVariant(banner.variant);
      setShareable(banner.shareable);
      setShareText(banner.shareText ?? '');
      setActive(banner.active);
      setStartsAt(toLocalInput(banner.startsAt));
      setEndsAt(toLocalInput(banner.endsAt));
    } else {
      setTitle('');
      setText('');
      setLinkUrl('');
      setLinkText('');
      setPlacements([]);
      setVariant('INFO');
      setShareable(false);
      setShareText('');
      setActive(true);
      setStartsAt('');
      setEndsAt('');
    }
  }, [open, banner]);

  function togglePlacement(value: BannerPlacement) {
    setPlacements((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    );
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const startsAtIso = new Date(startsAt).toISOString();
      const endsAtIso = new Date(endsAt).toISOString();

      if (isEdit) {
        // En edición, un campo vaciado por el admin debe LIMPIARSE (null) — no
        // simplemente "no cambiar" (undefined), a diferencia de crear.
        await updateAdminBanner(token, banner!.id, {
          title,
          text,
          linkUrl: linkUrl.trim() === '' ? null : linkUrl,
          linkText: linkText.trim() === '' ? null : linkText,
          placements,
          variant,
          shareable,
          shareText: shareText.trim() === '' ? null : shareText,
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
        });
      } else {
        await createAdminBanner(token, {
          title,
          text,
          linkUrl: linkUrl.trim() === '' ? undefined : linkUrl,
          linkText: linkText.trim() === '' ? undefined : linkText,
          placements,
          variant,
          shareable,
          shareText: shareText.trim() === '' ? undefined : shareText,
          active,
          startsAt: startsAtIso,
          endsAt: endsAtIso,
        });
      }
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar el banner.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar banner "${banner!.title}"` : 'Nuevo banner'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="banner-title">Título</Label>
            <Input id="banner-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="banner-text">Texto</Label>
            <Textarea id="banner-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="banner-link-url">Enlace (ruta u URL)</Label>
              <Input
                id="banner-link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="/mis-creditos"
              />
            </div>
            <div>
              <Label htmlFor="banner-link-text">Texto del enlace</Label>
              <Input
                id="banner-link-text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="Consíguelos"
              />
            </div>
          </div>

          <div>
            <Label>Ubicaciones</Label>
            <div className="mt-1 flex gap-4">
              {PLACEMENT_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`banner-placement-${opt.value}`}
                    data-testid={`banner-placement-${opt.value}`}
                    checked={placements.includes(opt.value)}
                    onCheckedChange={() => togglePlacement(opt.value)}
                  />
                  <Label htmlFor={`banner-placement-${opt.value}`} className="cursor-pointer font-normal">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="banner-variant">Estilo</Label>
            <Select value={variant} onValueChange={(v) => setVariant(v as BannerVariant)}>
              <SelectTrigger id="banner-variant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INFO">Info</SelectItem>
                <SelectItem value="PROMO">Promo</SelectItem>
                <SelectItem value="WARNING">Aviso</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="banner-shareable"
              data-testid="banner-shareable"
              checked={shareable}
              onCheckedChange={(checked) => setShareable(checked === true)}
            />
            <Label htmlFor="banner-shareable" className="cursor-pointer">
              Permitir compartir
            </Label>
          </div>

          {shareable && (
            <div>
              <Label htmlFor="banner-share-text">Texto a compartir</Label>
              <Input
                id="banner-share-text"
                value={shareText}
                onChange={(e) => setShareText(e.target.value)}
                placeholder="Vacío = usa el texto del banner"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="banner-starts-at">Empieza</Label>
              <Input
                id="banner-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="banner-ends-at">Termina</Label>
              <Input
                id="banner-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="banner-active"
              checked={active}
              onCheckedChange={(checked) => setActive(checked === true)}
            />
            <Label htmlFor="banner-active" className="cursor-pointer">
              Activo
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy || placements.length === 0}>
            {isEdit ? 'Guardar cambios' : 'Crear banner'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
