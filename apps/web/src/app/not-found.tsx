import { ButtonLink } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="container-x flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="display text-3xl font-extrabold">Nothing here.</h1>
      <p className="text-sm text-fg-muted">That page doesn&apos;t exist.</p>
      <ButtonLink href="/" variant="primary">
        Explore Arenas
      </ButtonLink>
    </main>
  );
}
