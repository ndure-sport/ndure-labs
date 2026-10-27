import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

export type Order = {
  id: string;
  token: string;
  status: 'pending' | 'paid' | 'refunded' | 'expired';
  created_at: string;
  paid_at: string | null;
  rider_name: string;
  rider_email: string;
  rider_phone: string | null;
  ftp: number | null;
  goal: string | null;
  qty: number;
  unit_price: number;
  total: number;
  amount_paid: number | null;
  addons: string[];
  credits_left: number;
  partner: boolean;
  partner_name: string | null;
  partner_email: string | null;
  partner_token: string | null;
  partner_used: boolean;
  partner_consents: unknown;
  consents: unknown;
  consent_version: string;
  src: string | null;
  stripe_session_id: string | null;
};

export type Booking = {
  id: string;
  order_id: string;
  created_at: string;
  status: 'booked' | 'cancelled';
  event_type_id: number;
  label: string;
  start_at: string;
  end_at: string | null;
  cal_uid: string;
  seat_uid: string | null;
  with_partner: boolean;
  partner_cal_uid: string | null;
  partner_seat_uid: string | null;
  cancelled_at: string | null;
  credit_returned: boolean;
};

export async function orderByToken(token: string): Promise<Order | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data, error } = await db().from('orders').select('*').eq('token', token).maybeSingle();
  if (error) throw error;
  return (data as Order) ?? null;
}

export async function bookingsFor(orderId: string): Promise<Booking[]> {
  const { data, error } = await db()
    .from('bookings')
    .select('*')
    .eq('order_id', orderId)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data as Booking[]) ?? [];
}

export async function useCredit(orderId: string): Promise<boolean> {
  const { data, error } = await db().rpc('use_credit', { p_order: orderId });
  if (error) throw error;
  return data === true;
}

export async function returnCredit(orderId: string): Promise<void> {
  const { error } = await db().rpc('return_credit', { p_order: orderId });
  if (error) throw error;
}
