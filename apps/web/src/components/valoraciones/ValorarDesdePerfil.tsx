'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getEligibility } from '@/lib/api/valoraciones';
import { useApiAction } from '@/lib/api/use-api-action';
import type { EligibilityResult } from '@/lib/api/valoraciones';
import { ReviewModal } from './ReviewModal';

const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

interface Props {
  listingId: string;
  targetId: string;
  targetName: string;
  token: string;
}

/**
 * Reputación RÁFAGA 3 — punto de entrada para valorar FUERA del chat: hace
 * falta porque un Deal declarado (comprador elegido por búsqueda libre al
 * cerrar el trato) no tiene ninguna Conversation asociada, así que el botón
 * "Valorar" de ChatClient.tsx nunca podría mostrarse para ese caso — no hay
 * conversación que abrir. Este componente vive en /vendedor/[slug], solo se
 * renderiza si la URL trae ?valorar=<listingId>&target=<userId> (el enlace
 * que manda la notificación REVIEW_REQUEST al cerrar el trato). Mismo patrón
 * de 3 estados que ChatClient: Valorar / Editar valoración / Ya valoraste.
 */
export function ValorarDesdePerfil({ listingId, targetId, targetName, token }: Props) {
  const { run } = useApiAction();
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function fetchEligibility() {
    await run(() => getEligibility(listingId, targetId, token), {
      onSuccess: (result) => setEligibility(result),
    });
  }

  useEffect(() => {
    void fetchEligibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canEdit =
    eligibility?.alreadyReviewed &&
    eligibility.existingReview !== null &&
    Date.now() < new Date(eligibility.existingReview.createdAt).getTime() + EDIT_WINDOW_MS;

  if (!eligibility) return null;
  if (!eligibility.canReview && !eligibility.alreadyReviewed) return null;

  return (
    <div className="mb-8 flex items-center gap-2 rounded-md border bg-muted/40 px-4 py-3">
      <p className="flex-1 text-sm text-muted-foreground">
        Cerraste un trato con {targetName} sobre este anuncio.
      </p>

      {eligibility.canReview && (
        <Button size="sm" className="gap-1.5" onClick={() => setModalOpen(true)}>
          <Star className="h-3.5 w-3.5" aria-hidden />
          Valorar
        </Button>
      )}
      {eligibility.alreadyReviewed && canEdit && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setModalOpen(true)}>
          <Star className="h-3.5 w-3.5" aria-hidden />
          Editar valoración
        </Button>
      )}
      {eligibility.alreadyReviewed && !canEdit && (
        <Badge variant="secondary" className="gap-1 text-xs">
          <CheckCircle2 className="h-3 w-3" aria-hidden />
          Ya valoraste
        </Badge>
      )}

      <ReviewModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        existingReviewId={canEdit ? (eligibility.existingReview?.id ?? null) : null}
        targetName={targetName}
        listingId={listingId}
        targetId={targetId}
        token={token}
        onSuccess={() => void fetchEligibility()}
        wouldBeVerified={eligibility.wouldBeVerified}
      />
    </div>
  );
}
