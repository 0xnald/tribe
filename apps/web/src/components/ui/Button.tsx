import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { onAsset } from '@/lib/color';

export type ButtonVariant = 'primary' | 'asset' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-[12px] font-semibold whitespace-nowrap select-none transition-[background-color,color,transform,opacity] duration-[var(--dur-fast)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-volt text-[#0e0f12] hover:brightness-95',
  asset: 'asset-fill text-[var(--on-asset,#0e0f12)] hover:brightness-95',
  secondary:
    'border border-line-strong bg-transparent text-fg hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]',
  ghost:
    'bg-transparent text-fg-muted hover:text-fg hover:bg-[color-mix(in_oklab,var(--fg)_6%,transparent)]',
  danger: 'bg-fall text-white hover:brightness-95',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-14 px-6 text-base tracking-wide',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Asset hue for the `asset` variant. */
  assetColor?: string;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  assetColor,
  className = '',
  style,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const s = assetColor
    ? { ...style, ['--asset' as string]: assetColor, ['--on-asset' as string]: onAsset(assetColor) }
    : style;
  return (
    <button type={type} className={buttonClass(variant, size, className)} style={s} {...rest}>
      {children}
    </button>
  );
}

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
