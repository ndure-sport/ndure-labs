// Everything on the Labs page that the team may want to change without touching layout.
// Leave a link empty ('') and the page hides that button or falls back to email.

export const CONTACT_EMAIL = 'performance@ndure.dk';

export const LINKS = {
  // Link to Jack's documentary. Empty: the link is hidden.
  jackStory: '',
  // Video of Anna explaining NDURE Labs (YouTube or Vimeo link). Empty: the section shows the photo only.
  annaVideo: '',
  // Footer links. Empty: the link or icon is hidden.
  youtube: '',
  linkedin: '',
  instagram: '',
  ambassador: '',
  careers: 'https://ndure.dk/careers',
  home: 'https://ndure.dk'
};

// Shown next to the kr prices as a rough guide. Kroner are what riders pay.
export const EUR_PER_DKK = 1 / 7.46;

// Jack's section only shows once he has approved the quote and the result wording.
export const JACK = {
  approved: false,
  name: 'Jack Roels',
  fact: 'Age group podium, IRONMAN World Championship',
  text: 'Jack does not test once and hope. He checks in at NDURE Labs every few weeks, so his zones always match his fitness.',
  quote: 'One test told me where I was. Coming back every few weeks told me if my training was actually working.'
};

export const PLAN_INFO: Record<number, { tier: string; tag: string; line: string; inc: string[]; not?: string[] }> = {
  1: { tier: 'Snapshot', tag: 'TRY IT', line: 'One look at your zones today.', inc: ['1 lab test with our performance physiologist', 'Continuous and blood lactate', 'Performance report', 'Your LT1, LT2 and zones'], not: ['No retest to follow your progress'] },
  3: { tier: 'Progress', tag: 'MOST RIDERS', line: 'Come back and see what works.', inc: ['3 lab tests with our performance physiologist', 'Continuous and blood lactate', 'Performance report after every test', 'New LT1, LT2 and zones every time you come back', 'See your progress test to test'] },
  6: { tier: 'Season', tag: 'LOWEST PRICE', line: 'Follow your progress all season.', inc: ['6 lab tests with our performance physiologist', 'Continuous and blood lactate', 'Performance report after every test', 'New LT1, LT2 and zones every time you come back', 'See your progress test to test'] }
};
export const RECOMMENDED = 3;
export const PLAN_ORDER = [1, 3, 6];

export const FLOW: [string, string][] = [
  ['Book', 'Pick your sessions and a date.'],
  ['Come in', 'DTU Science Park, Diplomvej 381, 2800 Kongens Lyngby.'],
  ['Meet Anna', 'Our performance physiologist.'],
  ['Ride the test', 'About 2 hours. We measure your lactate.'],
  ['Get your report', 'Your LT1, LT2 and zones.'],
  ['Come back', 'Remeasure in a few weeks.']
];

export const FAQS: [string, string][] = [
  ['Do I get a sensor to take home?', 'No. You ride with ours in the lab. NDURE Labs is a test, not a device.'],
  ['Where is the lab?', 'At DTU Science Park, Diplomvej 381, Kongens Lyngby. We pick you up at the reception.'],
  ['What do I bring?', 'Cycling shoes, bib shorts, a sleeveless top and a bottle. Showers are available after.'],
  ['I am not a pro. Is this for me?', 'Yes. If you ride regularly, you will get a lot out of it.'],
  ['How often should I come back?', 'We suggest every month, or every few weeks in your build. Your sessions are valid for 12 months.'],
  ['Can I change my date?', 'Yes, for free until 24 hours before your session.'],
  ['Is it a subscription?', 'No. You pay once.']
];
