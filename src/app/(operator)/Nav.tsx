'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The prototype's nine destinations: a 214px sidebar on desktop, bottom
 * tabs on mobile. The one red badge is work waiting on a decision.
 */
const NAV = [
  { href: '/', label: 'Today', icon: '◧', short: 'Today' },
  { href: '/work', label: 'Work', icon: '☰', short: 'Work' },
  { href: '/requests', label: 'Requests', icon: '↘', short: 'Reqs', badged: true },
  { href: '/clients', label: 'Clients', icon: '◎', short: 'Clients' },
  { href: '/updates', label: 'Updates', icon: '✎', short: 'Updates' },
  { href: '/review', label: 'Review', icon: '◱', short: 'Review' },
  { href: '/activity', label: 'Activity', icon: '⟲', short: 'Log' },
  { href: '/assistant', label: 'Assistant', icon: '✦', short: 'Ask' },
  { href: '/settings', label: 'Settings', icon: '⚙', short: 'Settings' },
];

/** Mobile keeps the five most-travelled destinations; the rest live in Settings. */
const MOBILE = ['/', '/work', '/requests', '/clients', '/assistant'];

export function Nav({ requestCount, operatorEmail, dateShort }: {
  requestCount: number;
  operatorEmail: string;
  dateShort: string;
}) {
  const pathname = usePathname();
  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      <nav className="sidebar" aria-label="Sections">
        <div className="sidebar__brand">
          <span className="brand-mark">A</span>
          Agency OS
        </div>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}>
            <span><span className="nav-ico">{item.icon}</span>{item.label}</span>
            {item.badged && requestCount > 0 && <span className="nav-badge">{requestCount}</span>}
          </Link>
        ))}
        <div className="sidebar__foot">
          <div>Signed in as</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>{operatorEmail}</div>
          <form action="/signout" method="POST">
            <button type="submit" className="as-link" style={{ fontSize: 11.5 }}>Sign out</button>
          </form>
        </div>
      </nav>

      <div className="mobile-topbar">
        <span className="brand-mark" style={{ width: 18, height: 18, fontSize: 10 }}>A</span>
        Agency OS
        <span className="num">{dateShort}</span>
      </div>

      <nav className="tabbar" aria-label="Sections">
        {NAV.filter((item) => MOBILE.includes(item.href)).map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}>
            <span className="nav-ico">{item.icon}</span>
            <span>{item.short}</span>
            {item.badged && requestCount > 0 && <span className="tabbar__badge">{requestCount}</span>}
          </Link>
        ))}
      </nav>
    </>
  );
}
