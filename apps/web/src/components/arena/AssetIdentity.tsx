'use client';

import Image from 'next/image';
import { useState } from 'react';

import type { AssetIdentity as AssetId } from '@/lib/arena/model';

/** Logo with a monogram fallback in the asset hue (no emoji, no invented marks). */
export function AssetLogo({
  asset,
  size = 32,
  className = '',
}: {
  asset: Pick<AssetId, 'symbol' | 'logoUrl' | 'color'> & { mint?: string; marketMint?: string };
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // Served through the logo proxy (cached server-side); falls back to the monogram on any error.
  const logoMint = asset.marketMint ?? asset.mint;
  const src = logoMint ? `/api/logo/${logoMint}` : asset.logoUrl;
  const showImg = src && !failed;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--asset)_22%,var(--bg-sunken))] ring-1 ring-[color-mix(in_oklab,var(--asset)_50%,transparent)] ${className}`}
      style={{ width: size, height: size, ['--asset' as string]: asset.color }}
      aria-hidden
    >
      {showImg ? (
        <Image
          src={src as string}
          alt=""
          width={size}
          height={size}
          unoptimized
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="display font-bold text-fg" style={{ fontSize: Math.max(10, size * 0.38) }}>
          {asset.symbol.replace(/x$/, '').slice(0, 3).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** Logo + symbol + class tag (DESIGN_SYSTEM §6.2). */
export function AssetIdentity({
  asset,
  size = 'md',
  showName = false,
  className = '',
}: {
  asset: AssetId;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showName?: boolean;
  className?: string;
}) {
  const logo = { sm: 24, md: 32, lg: 44, xl: 56 }[size];
  const text = {
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-3xl md:text-4xl',
    xl: 'text-4xl md:text-5xl',
  }[size];
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}
      style={{ ['--asset' as string]: asset.color }}
    >
      <AssetLogo asset={asset} size={logo} />
      <span className="flex min-w-0 flex-col leading-none">
        <span className={`display truncate font-bold ${text}`}>{asset.symbol}</span>
        {showName ? (
          <span className="mt-1 truncate text-xs text-fg-muted">
            {asset.name} · <span className="micro">{asset.classTag}</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}
