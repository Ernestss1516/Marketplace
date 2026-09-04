import { CompraConfirmadaClient } from './CompraConfirmadaClient';
import { getIlustracion } from '@/lib/api/ilustraciones';

/**
 * E7 — LA ENVOLTURA DE SERVIDOR, Y LO QUE JUSTIFICA PARTIR LA PANTALLA EN DOS.
 *
 * El cuerpo de esta confirmación es de cliente y lo seguirá siendo: sondea el saldo hasta
 * que el webhook lo acredita, así que necesita estado y efectos. Pero la ilustración la
 * resuelve el servidor —`getIlustracion` usa `unstable_cache`, que no existe en cliente—,
 * y un Server Component `async` no se puede importar desde uno de cliente.
 *
 * La salida es el patrón que este repo ya usa en media docena de pantallas
 * (`FavoritosClient`, `NotificacionesClient`, `MisTicketsClient`): una página de servidor
 * que resuelve los datos y un componente de cliente que los recibe por prop. **El cuerpo
 * no se ha tocado**: se renombró el fichero y se le añadió una prop, para que la
 * diferencia sea legible en el diff y no haya que releer 266 líneas para confiar en ella.
 *
 * La invariante de seguridad de la pantalla sigue donde estaba, escrita en el cliente:
 * esta página NO concede créditos ni ejecuta lógica de negocio.
 */
export default async function MisCreditosExitoPage() {
  return <CompraConfirmadaClient ilustracion={await getIlustracion('success-payment')} />;
}
