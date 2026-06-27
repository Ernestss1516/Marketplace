'use client';

import { useEffect, useRef } from 'react';
import type { RedsysFormData } from '@/lib/api/billing';

interface Props {
  formData: RedsysFormData;
}

/**
 * Mounts a hidden POST form targeting the Redsys TPV and auto-submits it via useEffect.
 * The form is the only way to send POST data to an external domain in a browser.
 * INVARIANT: this component is purely presentational — no business logic lives here.
 * Credits are acredited by the Redsys notification webhook, not by the return URL.
 */
export function RedsysRedirectForm({ formData }: Props) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.submit();
  }, []);

  return (
    <form
      ref={formRef}
      method="POST"
      action={formData.tpvUrl}
      data-testid="redsys-redirect-form"
    >
      <input type="hidden" name="Ds_MerchantParameters" value={formData.Ds_MerchantParameters} />
      <input type="hidden" name="Ds_SignatureVersion" value={formData.Ds_SignatureVersion} />
      <input type="hidden" name="Ds_Signature" value={formData.Ds_Signature} />
      <noscript>
        <button type="submit">Ir al TPV para completar el pago</button>
      </noscript>
    </form>
  );
}
