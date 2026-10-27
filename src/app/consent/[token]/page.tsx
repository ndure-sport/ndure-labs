import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { ConsentClient } from '@/components/ConsentClient';

export const dynamic = 'force-dynamic';

export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const { data } = await db().from('orders').select('rider_name, partner_consents, status').eq('partner_token', token).maybeSingle();
  if (!data || data.status !== 'paid') notFound();
  return <ConsentClient token={token} riderName={data.rider_name} alreadyDone={!!data.partner_consents} />;
}
