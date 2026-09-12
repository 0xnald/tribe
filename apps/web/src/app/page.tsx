import { PROTOCOL_NAME, TAGLINE } from '@tribe/core';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-sans text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">
        <span className="size-2 rounded-full bg-volt" aria-hidden />
        Phase 0 · architecture locked
      </span>
      <h1 className="font-display text-6xl font-bold tracking-tight md:text-7xl">
        {PROTOCOL_NAME}
      </h1>
      <p className="max-w-xl font-display text-2xl text-fg-muted md:text-3xl">{TAGLINE}</p>
    </main>
  );
}
