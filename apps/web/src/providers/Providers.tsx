'use client';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { ArenaView, SideKey } from '@/lib/arena/model';
import { getNetworkConfig } from '@/lib/config/network';

import { TooltipProvider } from '@/components/ui/Tooltip';

const BackSheet = dynamic(() => import('@/components/back/BackSheet').then((m) => m.BackSheet), {
  ssr: false,
});

interface BackRequest {
  arena: ArenaView;
  side: SideKey;
  session: number;
}

interface BackContextValue {
  openBack: (arena: ArenaView, side: SideKey) => void;
}

const BackContext = createContext<BackContextValue>({ openBack: () => undefined });

export function useBackSheet(): BackContextValue {
  return useContext(BackContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const cfg = useMemo(() => getNetworkConfig(), []);
  const [req, setReq] = useState<BackRequest | null>(null);
  const [open, setOpen] = useState(false);
  const openBack = useCallback((arena: ArenaView, side: SideKey) => {
    setReq((r) => ({ arena, side, session: (r?.session ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ openBack }), [openBack]);

  return (
    <ConnectionProvider endpoint={cfg.protocol.rpcUrl} config={{ commitment: 'confirmed' }}>
      {/* wallets=[] → Wallet Standard discovery (Phantom, Solflare, Backpack, …); nothing hard-coded */}
      <WalletProvider wallets={[]} autoConnect>
        <TooltipProvider>
          <BackContext.Provider value={value}>
            {children}
            {req ? (
              <BackSheet
                open={open}
                onOpenChange={setOpen}
                arena={req.arena}
                side={req.side}
                session={req.session}
              />
            ) : null}
          </BackContext.Provider>
        </TooltipProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
