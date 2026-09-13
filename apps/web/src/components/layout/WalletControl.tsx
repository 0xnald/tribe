'use client';

import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWallet } from '@solana/wallet-adapter-react';
import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';

import { shortAddress } from '@/lib/format';

import { buttonClass } from '../ui/Button';

/**
 * Wallet-standard connect control. Lists every wallet the browser exposes
 * (Phantom, Solflare, Backpack, …) instead of hard-coding one; stays out of
 * the way until a transaction actually needs it.
 */
export function WalletControl({ compact = false }: { compact?: boolean }) {
  const { wallets, select, connect, connected, connecting, disconnect, publicKey, wallet } =
    useWallet();
  const [open, setOpen] = useState(false);
  const installed = wallets.filter(
    (w) =>
      w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  if (connected && publicKey) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className={buttonClass('secondary', 'sm', 'font-mono')}
          aria-label={`Wallet ${publicKey.toBase58()}`}
        >
          <span className="size-2 rounded-full bg-rise" aria-hidden />
          {shortAddress(publicKey.toBase58())}
          <ChevronDown size={14} aria-hidden />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className="anim-fade z-50 w-56 rounded-[14px] border border-line bg-bg-elev p-2 shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
          >
            <div className="px-2 py-1.5 text-xs text-fg-muted">{wallet?.adapter.name}</div>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left text-sm hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]"
              onClick={() => {
                void disconnect();
                setOpen(false);
              }}
            >
              <LogOut size={16} strokeWidth={1.75} /> Disconnect
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={buttonClass('secondary', 'sm')} aria-label="Connect wallet">
        <Wallet size={16} strokeWidth={1.75} aria-hidden />
        {compact ? null : connecting ? 'Connecting…' : 'Connect'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="anim-fade z-50 w-64 rounded-[14px] border border-line bg-bg-elev p-2 shadow-[0_12px_32px_rgba(0,0,0,0.4)]"
        >
          <div className="px-2 py-1.5 text-xs text-fg-muted">Connect a Solana wallet</div>
          {installed.length === 0 ? (
            <div className="px-2 py-2 text-sm text-fg-muted">
              No wallet detected. Install Phantom, Solflare or Backpack, or open this page inside
              your wallet&apos;s browser on mobile.
            </div>
          ) : (
            installed.map((w) => (
              <button
                key={w.adapter.name}
                type="button"
                className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left text-sm hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]"
                onClick={() => {
                  select(w.adapter.name);
                  setOpen(false);
                  // select() is async under the hood; connect on the next tick
                  setTimeout(() => void connect().catch(() => undefined), 0);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs from the wallet itself */}
                <img src={w.adapter.icon} alt="" width={22} height={22} className="rounded-md" />
                {w.adapter.name}
              </button>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
