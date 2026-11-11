import { DEFAULT_CONFIG, noticeText } from '../core/config';
// Everything on the Labs page that the team may want to change without touching layout.
// Leave a link empty ('') and the page hides that button or falls back to email.

export const CONTACT_EMAIL = 'contact@ndure.dk';

export const LINKS = {
  // Calendly or Outlook booking page for the free 15 minute call. Empty: the button opens an email instead.
  introCall: '',
  // Link to Jack's documentary. Empty: the link is hidden.
  jackStory: ''
};

// The claim "other labs, about 1,500 kr for one test". Keep a dated source for this
// (Danish marketing law asks for comparisons to be verifiable). Set to 0 to hide the old price.
export const OTHER_LABS_PRICE = 1500;

// Jack's section only shows once he has approved the quote and the result wording.
export const JACK = {
  approved: false,
  name: 'Jack Roels',
  fact: 'Age group podium, IRONMAN World Championship',
  text: 'Jack does not test once and hope. He checks in at NDURE Labs every few weeks, so his zones always match his fitness.',
  quote: 'One test told me where I was. Coming back every few weeks told me if my training was actually working.'
};

export const PLAN_INFO: Record<number, { tier: string; line: string; inc: string[] }> = {
  1: { tier: 'Snapshot', line: 'One look at your zones today.', inc: ['1 lab test, about 2 h', 'Performance report within 48 h', 'Your training zones'] },
  3: { tier: 'Progress', line: 'Check in every few weeks and see what works.', inc: ['3 lab tests, about 2 h each', 'Performance report after every test', 'Updated zones at every check in', 'See your progress test to test'] },
  6: { tier: 'Season', line: 'Follow your progress all season.', inc: ['6 lab tests, about 2 h each', 'Performance report after every test', 'Updated zones at every check in', 'See your progress test to test'] }
};
export const RECOMMENDED = 3;
export const PLAN_ORDER = [1, 3, 6];

export const FLOW: [string, string][] = [
  ['Book online', `Pick your sessions and a date${noticeText(DEFAULT_CONFIG) ? `, at least ${noticeText(DEFAULT_CONFIG)} ahead` : ''}. Pay once.`],
  ['Get ready', 'You get a confirmation and calendar invite, and fill in a short form. Easy day before.'],
  ['Come to the lab', 'We pick you up at the DTU Science Park reception, Diplomvej 381, and set up the bike and the sensor.'],
  ['Ride the test', 'About an hour, a bit harder every few minutes. We measure your lactate.'],
  ['Get your report', 'Within 48 hours: your lactate curve, thresholds and zones.'],
  ['Train and check in', 'Train in your zones. Book your next session in 8 weeks.']
];

export const FAQS: [string, string][] = [
  ['Do I get a sensor?', 'No. You ride with ours in the lab. It stays there.'],
  ['Do I need to be in Denmark?', 'Yes. Every session is in person at our lab in Kongens Lyngby, near Copenhagen.'],
  ['I am not a pro. Is this for me?', 'Yes. If you ride regularly, you will get a lot out of it.'],
  ['Does the blood sample hurt?', 'It is a quick prick for one drop of blood.'],
  ['How do I book my next sessions?', 'Log in with your email and pick a date. Your sessions are valid for 12 months.'],
  ['Can I change my date?', 'Yes, for free until 24 hours before your session.'],
  ['Is it a subscription?', 'No. You pay once.']
];
