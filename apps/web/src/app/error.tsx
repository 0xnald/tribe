'use client';

import { Button } from '@/components/ui/Button';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container-x flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="display text-3xl font-extrabold">Something went wrong.</h1>
      <p className="max-w-md text-sm text-fg-muted">
        The page hit an error while loading. Your positions and assets are unaffected — nothing here
        moves funds.
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
