// The data the app keeps. Each type maps one to one onto a database table later.

export type ConsentKey = 'ready' | 'health' | 'terms' | 'research' | 'film';
export type Consents = { at: string; version: string; items: Record<ConsentKey, boolean> };

export type Customer = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  ftp: number | null;
  goal: string | null;
  createdAt: string;
  consents: Consents | null; // latest consent record
  sv?: number; // session version: raising it logs this rider out everywhere
  verified?: boolean; // has logged in with an emailed code at least once
};

export type Order = {
  id: string;
  customerId: string;
  status: 'pending' | 'paid' | 'expired' | 'refunded';
  qty: number;
  unit: number;
  total: number;
  remaining: number;
  partner: boolean;
  partnerName: string | null;
  partnerEmail: string | null;
  partnerUsed: boolean;
  free: boolean; // given by the team, not paid
  src: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  firstStart: string | null; // session picked before paying
  firstStatus: 'none' | 'pending' | 'booked' | 'failed';
  newCustomer?: boolean; // the rider was created by this checkout (only then may it log a browser in)
  consents?: Consents | null; // what the buyer agreed to in this checkout
  partnerToken?: string | null; // private link for the partner's own consent
  partnerConsents?: Consents | null;
  partnerPhone?: string | null;
  late?: boolean; // payment confirmed after the seat hold had run out
};

export type Booking = {
  id: string;
  customerId: string;
  orderId: string;
  start: string;
  end: string;
  blockId: string;
  label: string;
  seats: number; // 2 when a training partner rides along
  withPartner: boolean;
  partnerName: string | null;
  status: 'booked' | 'cancelled' | 'attended' | 'no_show';
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: 'rider' | 'team' | null;
  creditReturned: boolean;
};

export type Hold = { orderId: string; start: string; seats: number; expiresAt: string };

export type Email = {
  id: string;
  key: string; // makes sure each automatic email goes out once
  to: string;
  template: 'login_code' | 'payment' | 'confirmation' | 'partner' | 'rescheduled' | 'cancelled' | 'reminder' | 'after' | 'nudge' | 'expiry';
  subject: string;
  body: string;
  at: string;
  sent?: boolean; // set once the email provider accepted it
  error?: string;
  tries?: number;
  nextAt?: string; // earliest next try after a failure
  claimUntil?: string; // a sender is working on it until then
  failed?: boolean; // gave up after too many tries
};

// Something the team should know about (late payment, emails failing, data growing).
export type Alert = { id: string; at: string; kind: string; text: string; sent?: boolean; tries?: number; claimUntil?: string };

// Who did what. `by` is a team email, "rider:<email>", "stripe" or "system".
export type AuditEntry = { at: string; by: string; action: string; detail: string };

export type LoginCode = { email: string; code: string; expiresAt: string; attempts: number };

// Wrong login codes per account over the last 24 hours.
export type LoginFails = { key: string; n: number; since: string };

export type ClosedDay = { date: string; reason: string };

export type Db = {
  seq: number;
  customers: Customer[];
  orders: Order[];
  bookings: Booking[];
  holds: Hold[];
  emails: Email[];
  codes: LoginCode[];
  closed: ClosedDay[];
  done: string[]; // keys of old sent emails that were cleaned up, so they never go out again
  alerts: Alert[];
  audit: AuditEntry[];
  fails: LoginFails[];
  teamSv: Record<string, number>; // session version per team email
};

export const emptyDb = (): Db => ({
  seq: 0, customers: [], orders: [], bookings: [], holds: [], emails: [], codes: [], closed: [],
  done: [], alerts: [], audit: [], fails: [], teamSv: {}
});

// Fills in fields added after the data was first saved.
export function upgradeDb(db: Partial<Db>): Db {
  const fresh = emptyDb();
  for (const k of Object.keys(fresh) as (keyof Db)[]) if (db[k] === undefined) (db as any)[k] = fresh[k];
  return db as Db;
}
