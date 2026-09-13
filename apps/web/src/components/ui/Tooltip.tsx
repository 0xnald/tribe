'use client';

import { Tooltip as RT } from 'radix-ui';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={200}>{children}</RT.Provider>;
}

/**
 * Hover/focus tooltip. The trigger must be focusable so keyboard users get
 * the same information; on touch, tapping the trigger opens it.
 */
export function Tooltip({
  content,
  children,
  side = 'bottom',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="anim-fade z-50 max-w-[280px] rounded-[10px] border border-line bg-bg-elev px-3 py-2 text-[13px] leading-snug text-fg shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        >
          {content}
          <RT.Arrow className="fill-bg-elev" />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
