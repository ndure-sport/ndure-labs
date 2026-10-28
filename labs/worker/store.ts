// Storage for the MVP: the whole booking state is one JSON document in D1, saved with a
// version check. Two requests changing it at the same moment can't both win: the second
// one reloads and runs again. That makes double bookings impossible and keeps the engine
// identical to the prototype. At NDURE Labs' size (hundreds of riders) this is fast;
// move to one table per type before it reaches thousands.

import { emptyDb, upgradeDb, type Db } from '../core/types';

export type State = { db: Db; secrets: { session: string; feed: string }; staffSent: string[]; lastTick?: string; sizeWarned?: string };

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL: string;
  TEAM_EMAILS: string;
  EMAIL_FROM_NAME: string;
  EMAIL_FROM_ADDRESS: string;
  CURRENCY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BREVO_API_KEY: string;
  ALLOW_LIVE_PAYMENTS?: string; // set to "yes" only on launch day
  // Only for local testing against fake services.
  TURNSTILE_SITE_KEY?: string; // public key for the bot check on the pages
  TURNSTILE_SECRET_KEY?: string; // when set, checkout and login require a passed bot check
  RL_CHECKOUT?: RateLimit; // per IP, see wrangler.jsonc
  RL_LOGIN?: RateLimit;
  STRIPE_API_BASE?: string;
  TURNSTILE_API_BASE?: string;
  TEST_DB_DELAY_MS?: string; // local load tests only: imitates the network delay to D1
  BREVO_API_BASE?: string;
};

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const pause = (env: Env) => (env.TEST_DB_DELAY_MS ? new Promise((r) => setTimeout(r, Number(env.TEST_DB_DELAY_MS))) : null);

async function load(env: Env): Promise<{ state: State; version: number; bytes: number }> {
  await pause(env);
  const row = await env.DB.prepare('SELECT version, data FROM state WHERE id = 1').first<{ version: number; data: string }>();
  if (!row) throw new Error('State table missing. Run the setup SQL.');
  if (!row.data) {
    // First run: create the state with its secrets and save it, so every request uses the same secrets.
    const fresh: State = { db: emptyDb(), secrets: { session: randomToken(), feed: randomToken(24) }, staffSent: [] };
    await env.DB.prepare("UPDATE state SET data = ?1, version = version + 1, updated_at = datetime('now') WHERE id = 1 AND data = ''")
      .bind(JSON.stringify(fresh))
      .run();
    return load(env);
  }
  const state = JSON.parse(row.data) as State;
  state.db = upgradeDb(state.db);
  return { state, version: row.version, bytes: row.data.length };
}

export class Conflict extends Error {}

// Read only.
export async function read(env: Env): Promise<State> {
  return (await load(env)).state;
}

// Read only, with the size of the stored record (D1 refuses records over 2 MB).
export async function readWithSize(env: Env): Promise<{ state: State; bytes: number }> {
  const { state, bytes } = await load(env);
  return { state, bytes };
}

// Read, change, save. Retries when someone else saved in between.
// Under a burst (many payments confirmed in the same second) saves collide; each retry waits
// a little longer, at random, so they spread out: about 10 seconds in total before giving up.
const RETRIES = 14;
const backoff = (attempt: number) => Math.min(1200, 20 * 2 ** attempt) * (0.5 + Math.random());

export async function change<T>(env: Env, fn: (s: State) => T | Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const { state, version } = await load(env);
    const result = await fn(state);
    await pause(env);
    const res = await env.DB.prepare("UPDATE state SET data = ?1, version = version + 1, updated_at = datetime('now') WHERE id = 1 AND version = ?2")
      .bind(JSON.stringify(state), version)
      .run();
    if (res.meta.changes === 1) return result;
    await new Promise((r) => setTimeout(r, backoff(attempt)));
  }
  throw new Conflict('Busy, please try again.');
}
