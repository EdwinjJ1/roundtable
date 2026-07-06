import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/ui/styles/tokens.css';
import { Providers } from '@/ui/components/providers';

export const metadata: Metadata = {
  title: 'Roundtable',
  description: 'Multi-agent collaboration workbench',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning covers ONLY this element's attributes: browser
    // extensions (translators, recorders) stamp data-* attrs onto <html> before
    // React hydrates, which is noise, not an app bug.
    <html lang="en" data-aesthetic="neutral" data-theme="light" data-density="balanced" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
