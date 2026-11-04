// Pieces every page uses: talking to the server, the bot check, header and footer.

import { useEffect, useRef } from 'react';
import type { ConsentKey } from '../core/types';
import { CONTACT_EMAIL } from './content';

export const kr = (n: number) => `${n.toLocaleString('en-US')} kr`;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? { cache: 'no-store', credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('No connection. Check your internet and try again.', 0);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || (res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong. Try again, or email ' + CONTACT_EMAIL + '.'), res.status);
  return data as T;
}

export type Note = { kind: 'ok' | 'err'; text: string } | null;
export function Msg({ note }: { note: Note }) {
  return note ? <div className={`msg ${note.kind}`} role={note.kind === 'err' ? 'alert' : 'status'}>{note.text}</div> : null;
}

export type PublicConfig = {
  currency: string;
  tiers: { min: number; unit: number }[];
  maxQty: number;
  validityMonths: number;
  changeDeadlineHours: number;
  consents: Record<ConsentKey, string>;
  required: ConsentKey[];
  turnstileSiteKey: string | null;
};
let configPromise: Promise<PublicConfig> | null = null;
export const getConfig = () => {
  configPromise ??= api<PublicConfig>('/api/config').catch((e) => {
    configPromise = null; // try again next time
    throw e;
  });
  return configPromise;
};

// Cloudflare Turnstile, the bot check. Shows nothing until the team switches it on.
export function Turnstile({ siteKey, onToken }: { siteKey: string | null; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const w = window as any;
    let id: string | undefined;
    let gone = false;
    const render = () => {
      if (gone || !ref.current) return;
      id = w.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(''),
        'error-callback': () => cb.current('')
      });
    };
    if (w.turnstile) render();
    else {
      let s = document.getElementById('cf-turnstile') as HTMLScriptElement | null;
      if (!s) {
        s = document.createElement('script');
        s.id = 'cf-turnstile';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', render);
    }
    return () => {
      gone = true;
      try { if (id) w.turnstile.remove(id); } catch { /* already gone */ }
    };
  }, [siteKey]);
  return siteKey ? <div ref={ref} className="turnstile" /> : null;
}

export function Header({ home = false }: { home?: boolean }) {
  const h = (a: string) => (home ? a : `/${a}`);
  return (
    <header className="hdr">
      <div className="hdr-in">
        <a href="/" className="brand" aria-label="NDURE Labs, home">NDURE <span>LABS</span></a>
        <nav aria-label="Main">
          <a className="n" href={h('#back')}>Why come back</a>
          <a className="n" href={h('#book')}>Prices</a>
          <a className="n" href={h('#faq')}>FAQ</a>
          <a className="btn ghost sm" href="/account">{home ? 'Log in' : 'My account'}</a>
          <a className="btn" href={h('#book')}>Book</a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="ftr">
      <span>NDURE ApS · CVR 45530701 · Diplomvej 376, 2800 Kongens Lyngby</span>
      <nav aria-label="Footer">
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/health-check">Health check</a>
      </nav>
    </footer>
  );
}
