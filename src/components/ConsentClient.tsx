'use client';

import { useState } from 'react';
import { CONSENT_TEXT, type ConsentKey } from '@/lib/policy';
import { Header } from './Header';

export function ConsentClient({ token, riderName, alreadyDone }: { token: string; riderName: string; alreadyDone: boolean }) {
  const [c, setC] = useState<Record<ConsentKey, boolean>>({ ready: false, health: false, terms: false, research: false, film: false });
  const [done, setDone] = useState(alreadyDone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = c.ready && c.health && c.terms;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/consent/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consents: c }) });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) setError(d.error || 'Something went wrong.');
    else setDone(true);
  }

  return (
    <>
      <Header />
      <div className="narrow">
        <div className="stack">
          <span className="eyebrow">Training partner</span>
          <h1 className="h1">{done ? "You're all set." : 'Before you ride.'}</h1>
          <p className="lead">
            {done
              ? `Thanks. ${riderName} chooses the date and you will get a calendar invite.`
              : `${riderName} signed you up for a lactate session at NDURE Labs. Please confirm the points below. They are about you, so only you can tick them.`}
          </p>
        </div>
        {!done && (
          <form className="stack-lg" onSubmit={submit}>
            {error && <div className="error" role="alert">{error}</div>}
            <fieldset className="consents">
              <legend>Your consent</legend>
              {(Object.keys(CONSENT_TEXT) as ConsentKey[]).map((k) => (
                <label key={k} className={`consent${k === 'research' || k === 'film' ? ' opt' : ''}`}>
                  <input type="checkbox" checked={c[k]} onChange={() => setC({ ...c, [k]: !c[k] })} />
                  <span>{CONSENT_TEXT[k]}</span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="btn" disabled={!ok || busy}>{busy ? 'Saving…' : 'Confirm'}</button>
          </form>
        )}
      </div>
    </>
  );
}
