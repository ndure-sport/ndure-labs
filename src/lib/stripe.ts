import 'server-only';
import Stripe from 'stripe';
import { env } from './env';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) client = new Stripe(env('STRIPE_SECRET_KEY'));
  return client;
}

export function cents(euros: number): number {
  return Math.round(euros * 100);
}
