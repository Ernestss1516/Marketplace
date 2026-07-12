import type { Metadata } from 'next';
import { ContactForm } from './_components/ContactForm';

export const metadata: Metadata = {
  title: 'Contacto',
  description: '¿Tienes alguna duda o quieres reportar algo? Escríbenos y te responderemos por email.',
};

export default function ContactoPage() {
  return (
    <div className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold">Contacto</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        ¿Tienes alguna duda o quieres reportar algo? Escríbenos y te responderemos por email.
      </p>
      <ContactForm />
    </div>
  );
}
