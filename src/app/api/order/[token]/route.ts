import { orderByToken, bookingsFor } from '@/lib/db';
import { publicOrder } from '@/lib/public';
import { json, fail } from '@/lib/util';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = await orderByToken(token);
  if (!order) return fail('Order not found.', 404);
  return json(publicOrder(order, await bookingsFor(order.id)));
}
