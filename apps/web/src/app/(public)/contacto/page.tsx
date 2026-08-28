import type { Metadata } from 'next';
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { ContactForm } from './_components/ContactForm';

export const metadata: Metadata = {
  title: 'Contacto',
  description: '¿Tienes alguna duda o quieres reportar algo? Escríbenos y te responderemos por email.',
};

/**
 * Única página pública que no pedía NADA al backend: era una función síncrona
 * que montaba el formulario y ya. Pasa a `async` por el banner, y el `.catch`
 * es lo que hace que ese cambio de naturaleza sea inocuo — si la API no
 * responde, el formulario se sirve igual, que es lo único que esta página debe
 * garantizar.
 *
 * Y es de las ubicaciones que más lo piden aunque parezca una página de foco: un
 * aviso aquí («el soporte responde con retraso esta semana», «para reportar un
 * anuncio usa el botón de la ficha») DESVÍA trabajo antes de que se escriba el
 * mensaje, en vez de estorbar.
 */
export default async function ContactoPage() {
  const banners = await getActiveBanners('CONTACTO').catch(() => []);

  return (
    <div className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold">Contacto</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        ¿Tienes alguna duda o quieres reportar algo? Escríbenos y te responderemos por email.
      </p>

      {banners.length > 0 && (
        <div className="mb-6">
          <BannerList banners={banners} />
        </div>
      )}

      <ContactForm />
    </div>
  );
}
