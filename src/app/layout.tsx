import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Agency OS',
  description: 'Task capture, scheduling aur client reporting',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Agency OS', statusBarStyle: 'black-translucent' },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0f1115',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        background: '#0f1115',
        color: '#e6e8ee',
      }}>
        {children}
      </body>
    </html>
  );
}
