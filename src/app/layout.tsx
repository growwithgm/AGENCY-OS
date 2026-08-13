import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import './globals.css';

/**
 * The three voices of the product — self-hosted, no CDN at build or run
 * time. Archivo for the interface, Source Serif for the client's prose,
 * IBM Plex Mono for every number the operator steers by. Archivo and
 * Source Serif ship as variable fonts; Plex Mono as three statics.
 */
const archivo = localFont({
  src: '../fonts/archivo-var.woff2',
  weight: '400 700',
  variable: '--font-ui',
  display: 'swap',
});

const sourceSerif = localFont({
  src: [
    { path: '../fonts/sourceserif4-var.woff2', weight: '300 600', style: 'normal' },
    { path: '../fonts/sourceserif4-var-italic.woff2', weight: '300 600', style: 'italic' },
  ],
  variable: '--font-serif',
  display: 'swap',
});

const plexMono = localFont({
  src: [
    { path: '../fonts/ibmplexmono-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/ibmplexmono-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/ibmplexmono-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agency OS',
  description: 'Capacity-aware work management for solo agencies',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Agency OS', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#e9edf0',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${sourceSerif.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
