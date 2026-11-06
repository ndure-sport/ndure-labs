// The data the app keeps. Each type maps one to one onto a database table later.

export type ConsentKey = 'ready' | 'health' | 'inperson' | 'terms' | 'research' | 'film';
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
  noReminders?: boolean; // asked not to get check in emails (link in every such email)
  stopToken?: string; // private part of that link
  followUpOn?: string | null; // YYYY-MM-DD the team wants to follow up
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
  parentId?: string | null; // extra sessions added to this pack from the account
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

// Someone who might book: met at an event, asked for a call, wrote on Instagram.
export type LeadStatus = 'new' | 'contacted' | 'interested' | 'not_now' | 'booked';
export type Lead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string; // where we met them
  note: string;
  status: LeadStatus;
  okToCall: boolean; // they asked us to call or said yes to it (Danish law: no cold calls to private people)
  followUpOn: string | null; // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
};

// Every call, email or note about a rider or a lead. Check in emails the system sends land here too.
export type Contact = { id: string; at: string; by: string; customerId: string | null; leadId: string | null; kind: 'call' | 'email' | 'note'; text: string };

export type Hold = { orderId: string; start: string; seats: number; expiresAt: string };

export type Email = {
  id: string;
  key: string; // makes sure each automatic email goes out once
  to: string;
  template: 'login_code' | 'payment' | 'confirmation' | 'partner' | 'rescheduled' | 'cancelled' | 'reminder' | 'after' | 'nudge' | 'expiry' | 'checkin';
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
  leads: Lead[];
  contacts: Contact[];
  hours: Record<string, string[]> | null; // per weekday (0 Sunday … 6 Saturday): open session blocks; null = the defaults in config
  opensOn?: string; // first bookable day for riders, set by the team ('' = no limit); missing = config
  emailOff: string[]; // automatic emails the team switched off (templates)
  autoPaused: { at: string; count: number; keys: string[] } | null; // safety stop: all automatic emails paused after an unusual burst
  burstOkUntil?: string; // the team said "send them anyway": no safety stop until then
};

export const emptyDb = (): Db => ({
  seq: 0, customers: [], orders: [], bookings: [], holds: [], emails: [], codes: [], closed: [],
  done: [], alerts: [], audit: [], fails: [], teamSv: {}, leads: [], contacts: [], hours: null, emailOff: [], autoPaused: null
});

// Fills in fields added after the data was first saved.
export function upgradeDb(db: Partial<Db>): Db {
  const fresh = emptyDb();
  for (const k of Object.keys(fresh) as (keyof Db)[]) if (db[k] === undefined) (db as any)[k] = fresh[k];
  return db as Db;
}
