// The few answers of the pre session form that matter at the bike. Found by the question text,
// so a reworded question in Tally still works as long as these words stay in it.
import type { PreForm } from './types';

const find = (f: PreForm, re: RegExp) => f.answers.find((x) => re.test(x.q))?.a ?? '';

export function formKeys(f: PreForm) {
  const own = find(f, /own bike/i);
  return {
    ftp: find(f, /ftp/i),
    bike: own ? (/^yes/i.test(own) ? 'Own bike' : 'Lab bike') : '',
    cleats: find(f, /cleats/i),
    saddle: find(f, /saddle/i),
    reach: find(f, /reach/i)
  };
}

// One line for the 07:00 list: "FTP 265 W · lab bike, Shimano SPD-SL · saddle 720 mm".
export function formLine(f: PreForm): string {
  const k = formKeys(f);
  const bike = [k.bike === 'Own bike' ? 'OWN BIKE' : k.bike.toLowerCase(), k.cleats].filter(Boolean).join(', ');
  return [k.ftp && `FTP ${k.ftp} W`, bike, k.saddle && `saddle ${k.saddle} mm`].filter(Boolean).join(' · ');
}
