import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { auth } from '@/lib/auth';
import { AuthProvider } from '@/components/auth-provider';
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
      </body>
    </html>
  );
}
