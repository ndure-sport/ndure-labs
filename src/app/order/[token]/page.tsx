import { notFound } from 'next/navigation';
import { orderByToken, bookingsFor } from '@/lib/db';
import { publicOrder } from '@/lib/public';
import { OrderClient } from '@/components/OrderClient';

export const dynamic = 'force-dynamic';

export default async function OrderPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const order = await orderByToken(token);
  if (!order) notFound();
  const initial = publicOrder(order, await bookingsFor(order.id));
  return <OrderClient token={token} initial={initial} justPaid={sp.paid === '1'} />;
}
