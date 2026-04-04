import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { Toaster } from 'sonner';
import { headers } from 'next/headers';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Web3QL Cloud',
  description: '100% on-chain SQL database dashboard — powered by Celo',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const headersObj = await headers();
  const cookies    = headersObj.get('cookie');

  return (
    <html
      lang="en"
      className={`${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full font-[var(--font-inter)]">
        <Providers cookies={cookies}>{children}</Providers>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: { fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif' },
          }}
        />
      </body>
    </html>
  );
}
