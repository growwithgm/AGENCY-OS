'use client';

import { usePathname } from 'next/navigation';

/**
 * Bottom tabs on mobile, sidebar on desktop — the same four destinations.
 * Desktop adds width, not features.
 */
const TABS = [
  { href: '/', label: 'Today' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/clients', label: 'Clients' },
  { href: '/assistant', label: 'Assistant' },
];

const SIDEBAR_EXTRA = [
  { href: '/week', label: 'The week' },
  { href: '/availability', label: 'Availability' },
];

export function Nav({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();
  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      <nav className="sidebar" aria-label="Sections">
        <div style={{ fontWeight: 600, padding: '0 12px 18px' }}>Ledger</div>
        {[TABS[0], SIDEBAR_EXTRA[0], TABS[1], TABS[2], TABS[3], SIDEBAR_EXTRA[1]].map((tab) => (
          <a key={tab.href} href={tab.href} aria-current={isCurrent(tab.href) ? 'page' : undefined}>
            <span>{tab.label}</span>
            {tab.href === '/inbox' && inboxCount > 0 && (
              <span className="tabbar__badge">{inboxCount}</span>
            )}
          </a>
        ))}
      </nav>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((tab) => (
          <a key={tab.href} href={tab.href} aria-current={isCurrent(tab.href) ? 'page' : undefined}>
            <span>{tab.label}</span>
            {tab.href === '/inbox' && inboxCount > 0 && (
              <span className="tabbar__badge">{inboxCount}</span>
            )}
          </a>
        ))}
      </nav>
    </>
  );
}
