import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';

import { BottomTabs, Nav } from '@/components/layout/Nav';
import { getNetworkConfig } from '@/lib/config/network';
import { Providers } from '@/providers/Providers';

import './globals.css';

const display = Bricolage_Grotesque({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
  axes: ['wdth', 'opsz'],
});

const sans = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(getNetworkConfig().appUrl),
  title: { default: 'Tribe — Own what you believe in', template: '%s · Tribe' },
  description:
    "Don't bet on what you believe in. Own it. Back real assets in time-boxed Arenas where two assets compete on relative performance.",
  openGraph: { siteName: 'Tribe', type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#0e0f12',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <Providers>
          <Nav />
          <div className="flex flex-1 flex-col pb-16 md:pb-0">{children}</div>
          <BottomTabs />
        </Providers>
      </body>
    </html>
  );
}
