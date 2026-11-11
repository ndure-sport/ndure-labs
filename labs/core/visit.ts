// Everything a rider needs to know for their visit, in one place, so the website, the account
// page, the emails and the calendar invites all say the same thing. Change it here only.

import type { Booking, Customer } from './types';
import { fmt } from './time';

export const MEET = 'DTU Science Park reception, Diplomvej 381, 2800 Kongens Lyngby';
export const MEET_SHORT = 'DTU Science Park reception, Diplomvej 381';
export const MEET_MAPS = 'https://maps.google.com/?q=Diplomvej+381,+2800+Kongens+Lyngby';
export const PICKUP = 'We pick you up at the reception.';

export const PREP = [
  'Avoid hard or long training in the 24 hours before.',
  'Eat as you normally would, with a normal meal 2 to 3 hours before.',
  'Drink as you normally would.'
];
export const BRING = [
  'Cycling shoes and bib shorts',
  'A sleeveless top (the sensor goes on your upper arm)',
  'A water bottle',
  'Your heart rate strap, if you have one'
];
export const PEDALS = 'Our bike has Shimano SPD-SL pedals. Other cleats? Bring your own pedals.';
export const SHOWERS = 'Showers are available after your session.';
// The list as one sentence, for the session card in emails and the account page.
export const BRING_SENTENCE = 'Cycling shoes and bib shorts, a sleeveless top (the sensor goes on your upper arm), a water bottle, your heart rate strap if you have one';
// For calendar events, where there is one line of room.
export const BRING_SHORT = 'cycling shoes and bib shorts, a sleeveless top, a water bottle, your heart rate strap if you have one. Our bike has Shimano SPD-SL pedals. Other cleats? Bring your own pedals.';
// The one line version on the Labs page.
export const BRING_LINE = 'Cycling shoes, bib shorts, a sleeveless top, a bottle';

// The pre session form in Tally. Name, email, FTP, session and booking are filled in from the link.
export const FORM_URL = 'https://tally.so/r/peyDxB';
export function formLink(c: Pick<Customer, 'name' | 'email' | 'ftp'>, b: Pick<Booking, 'id' | 'start'>): string {
  const q = new URLSearchParams({ name: c.name, email: c.email, session: fmt(b.start, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), booking: b.id });
  if (c.ftp) q.set('ftp', String(c.ftp));
  return `${FORM_URL}?${q}`;
}
