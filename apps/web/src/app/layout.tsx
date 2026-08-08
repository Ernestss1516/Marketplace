import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { auth } from '@/lib/auth';
import { AuthProvider } from '@/components/auth-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Marketplace — Compra y vende de segunda mano',
    template: '%s | Marketplace',
  },
  description: 'Plataforma de compraventa de segunda mano entre particulares.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="es">
      <body className={inter.className}>
        <AuthProvider session={session}>{children}</AuthProvider>
        {/* UXV.3 (M6) — UNA sola vez y en la raíz: así cualquier pantalla de cualquier
            zona puede avisar de algo con `toast(...)` sin montar nada propio. Va FUERA
            de AuthProvider a propósito: no depende de la sesión, y un toast tiene que
            poder salir también en las pantallas anónimas. */}
        <Toaster />
      </body>
    </html>
  );
}
