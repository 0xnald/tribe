import { ButtonLink } from '@/components/ui/Button';

export default function ArenaNotFound() {
  return (
    <main className="container-x flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="micro text-fg-muted">Arena</p>
      <h1 className="display text-3xl font-extrabold">This Arena doesn&apos;t exist.</h1>
      <p className="max-w-md text-sm text-fg-muted">
        The link may be from a finished season, or the Arena was never created on this network.
      </p>
      <ButtonLink href="/" variant="primary">
        Explore Arenas
      </ButtonLink>
    </main>
  );
}
