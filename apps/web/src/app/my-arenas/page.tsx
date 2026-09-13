import type { Metadata } from 'next';

import { MyArenas } from '@/components/positions/MyArenas';
import { listArenas } from '@/lib/arena/repo';
import { nowSecs } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My Arenas' };

export default async function MyArenasPage() {
  const now = nowSecs();
  const arenas = await listArenas(now);
  return <MyArenas initialArenas={arenas} serverNow={now} />;
}
