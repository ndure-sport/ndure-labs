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
};

export type LoginCode = { email: string; code: string; expiresAt: string; attempts: number };

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
};

export const emptyDb = (): Db => ({ seq: 0, customers: [], orders: [], bookings: [], holds: [], emails: [], codes: [], closed: [] });
