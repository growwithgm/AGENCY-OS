import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Agency OS',
  description: 'Task capture → AI structuring → auto scheduling → client reporting',
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
