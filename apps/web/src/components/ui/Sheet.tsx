'use client';

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

/**
 * Bottom sheet on mobile, centered dialog from `md` up. Focus-trapped,
 * dismissible with Escape, labelled by `title` for screen readers.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  hideTitle = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  hideTitle?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[rgba(6,7,9,0.72)] backdrop-blur-[2px]" />
        <Dialog.Content
          className="anim-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[24px] border border-line bg-bg-elev shadow-[0_-8px_40px_rgba(0,0,0,0.45)] outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-[500px] md:max-h-[88dvh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[24px]"
          aria-describedby={description ? undefined : ''}
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 md:px-6">
            <Dialog.Title className={hideTitle ? 'sr-only' : 'display text-lg font-bold'}>
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="ml-auto inline-flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-[color-mix(in_oklab,var(--fg)_8%,transparent)] hover:text-fg"
              aria-label="Close"
            >
              <X size={18} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="sr-only">{description}</Dialog.Description>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] md:px-6 md:pb-6">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
