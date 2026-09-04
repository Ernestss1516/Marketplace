import { ProConfirmadoClient } from './ProConfirmadoClient';
import { getIlustracion } from '@/lib/api/ilustraciones';

/**
 * E7 — envoltura de servidor, mismo caso y mismo remedio que
 * `mis-creditos/exito/page.tsx`: el cuerpo sondea los entitlements y es de cliente; la
 * ilustración la resuelve el servidor. El cuerpo se renombró sin tocarse.
 *
 * Comparte slot con la confirmación de créditos (`success-payment`) a propósito: las dos
 * dicen lo mismo —«tu pago se ha procesado»— y un registro cerrado no crece por tener dos
 * pantallas del mismo hecho. Si algún día una instancia quiere distinguirlas, eso es un
 * slot nuevo y por tanto un despliegue, que es exactamente la decisión #5.
 */
export default async function PlanesExitoPage() {
  return <ProConfirmadoClient ilustracion={await getIlustracion('success-payment')} />;
}
