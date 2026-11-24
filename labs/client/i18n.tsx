// Danish and English for the Labs page and the booking page (/book).
// The rest of the app (account, team, emails, legal pages) stays English.
// First visit: follows the browser language. After a click on the toggle: remembered in this browser.

import { useSyncExternalStore } from 'react';
import { fmt as fmtBase } from '../core/time';
import { EUR_PER_DKK } from './content';

export type Lang = 'en' | 'da';
const KEY = 'ndure-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'da' || saved === 'en') return saved;
  } catch { /* storage can be blocked: fall back to the browser language */ }
  return (navigator.languages ?? [navigator.language]).some((l) => /^(da|nb|nn|no)\b/i.test(l)) ? 'da' : 'en';
}

let current: Lang = typeof window === 'undefined' ? 'en' : detect();
const subs = new Set<() => void>();

export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* not remembered, still switches */ }
  document.documentElement.lang = l;
  subs.forEach((f) => f());
}

export function useLang(): Lang {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current, () => 'en');
}

// Everything a page needs to write in the chosen language.
export function useT() {
  const lang = useLang();
  const da = lang === 'da';
  const locale = da ? 'da-DK' : 'en-GB';
  const fmt = (iso: string | number, o: Intl.DateTimeFormatOptions) => fmtBase(iso, o, locale);
  return {
    lang,
    da,
    t: (en: string, dk: string) => (da ? dk : en),
    kr: (n: number) => `${n.toLocaleString(da ? 'da-DK' : 'en-US')} kr`,
    eur: (n: number) => `${da ? 'ca.' : 'about'} €${Math.round(n * EUR_PER_DKK)}`,
    longDay: (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }),
    clock: (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' }),
    when: (iso: string) => `${fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt(iso, { hour: '2-digit', minute: '2-digit' })}`,
    fmt
  };
}

export function LangToggle() {
  const lang = useLang();
  return (
    <span className="lang" role="group" aria-label="Language / Sprog">
      <button type="button" aria-pressed={lang === 'da'} onClick={() => setLang('da')} lang="da">DA</button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">EN</button>
    </span>
  );
}
