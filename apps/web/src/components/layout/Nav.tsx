'use client';

import { Compass, Plus, Swords } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ProvenanceStatus } from './ProvenanceStatus';
import { WalletControl } from './WalletControl';

const LINKS = [
  { href: '/', label: 'Explore', icon: Compass },
  { href: '/my-arenas', label: 'My Arenas', icon: Swords },
  { href: '/create', label: 'Create', icon: Plus },
] as const;

function isActive(path: string, href: string): boolean {
  return href === '/' ? path === '/' || path.startsWith('/arena') : path.startsWith(href);
}

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-md">
      <div className="container-x flex h-14 items-center gap-3 md:h-16">
        <Link
          href="/"
          className="display flex items-center gap-2 text-[22px] font-extrabold tracking-tight"
          aria-label="Tribe home"
        >
          <span className="inline-flex size-7 items-center justify-center rounded-[8px] bg-volt text-[#0e0f12] text-sm font-black">
            T
          </span>
          Tribe
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive(path, href)
                  ? 'bg-[color-mix(in_oklab,var(--fg)_8%,transparent)] text-fg'
                  : 'text-fg-muted hover:text-fg'
              }`}
              aria-current={isActive(path, href) ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ProvenanceStatus />
          <WalletControl />
        </div>
      </div>
    </header>
  );
}

/** Mobile bottom tab bar (DESIGN_SYSTEM §6.12). Hidden from `md` up. */
export function BottomTabs() {
  const path = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? 'text-volt-fg' : 'text-fg-muted'}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
