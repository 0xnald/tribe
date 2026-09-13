import { Explore } from '@/components/arena/Explore';
import { listArenas } from '@/lib/arena/repo';
import { nowSecs } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const now = nowSecs();
  const arenas = await listArenas(now);
  return <Explore initial={arenas} serverNow={now} />;
}
