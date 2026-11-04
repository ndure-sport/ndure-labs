// Team: every email the system sends, which automatic ones are on, and a log of what went out.

import { useMemo, useState } from 'react';
import { when } from '../core/time';
import { api } from './shared';

export type EmailsData = {
  automations: { template: string; name: string; when: string; to: string; kind: 'essential' | 'automatic' | 'manual' | 'team'; on: boolean; last30: number }[];
  team: string[];
  teamCalendar: string | null;
  paused: { at: string; count: number; keys: string[] } | null;
  log: { id: string; at: string; to: string; template: string; subject: string; status: 'sent' | 'failed' | 'retrying' | 'waiting'; error: string | null }[];
};
type Act = (payload: object, ok: string) => Promise<boolean>;
type Preview = { subject: string; html: string; text: string; example: boolean } | null;

const STATUS = { sent: ['Sent', 'ok'], failed: ['Failed', 'due'], retrying: ['Retrying', 'fine'], waiting: ['Waiting', 'fine'] } as const;

export function Emails({ d, act }: { d: EmailsData; act: Act }) {
  const [preview, setPreview] = useState<Preview>(null);
  const [err, setErr] = useState<string | null>(null);
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const names = Object.fromEntries(d.automations.map((a) => [a.template, a.name]));
  const show = (query: string) => {
    setErr(null);
    api<NonNullable<Preview>>(`/api/team/email-preview?${query}`).then(setPreview, (e) => setErr(e.message));
  };
  const log = useMemo(() => d.log.filter((x) => (type === 'all' || x.template === type) && (!q || x.to.includes(q.toLowerCase()) || x.subject.toLowerCase().includes(q.toLowerCase()))), [d.log, type, q]);
  const groups: [string, string, typeof d.automations][] = [
    ['Automatic', 'Go out by themselves. You can switch these off.', d.automations.filter((a) => a.kind === 'automatic')],
    ['Essential', 'Part of booking and paying. Always on.', d.automations.filter((a) => a.kind === 'essential')],
    ['Manual', 'Only when someone on the team sends it.', d.automations.filter((a) => a.kind === 'manual')]
  ];

  return (
    <>
      {d.paused && (
        <div className="msg err stack g8">
          <span><b>All automatic emails are paused.</b> On {when(d.paused.at)}, {d.paused.count} automatic emails were about to go out at once, which is far more than normal. Nothing was sent. Essential emails (payments, bookings, login codes) kept working.</span>
          <span className="row">
            <button className="primary" onClick={() => act({ action: 'emails_resume', send: false }, `Resumed. The ${d.paused!.count} held emails are dropped and will not go out.`)}>Drop the held emails and resume</button>
            <button onClick={() => { if (confirm(`Send all ${d.paused!.count} held emails now?`)) act({ action: 'emails_resume', send: true }, 'Resumed. The held emails go out in the next minutes.'); }}>Send them anyway</button>
          </span>
        </div>
      )}
      {err && <div className="msg err">{err}</div>}

      <section className="card">
        <h2 style={{ margin: 0 }}>What we send</h2>
        <p className="small muted" style={{ margin: 0 }}>Every email the booking system can send. "Preview" shows an example with made up data, exactly as riders see it. Safety: automatic emails only go out within a short window (a week or two after their moment), so switching one back on never sends old ones, and more than 40 at once pauses them all.</p>
        {groups.map(([title, sub, list]) => (
          <div key={title} className="stack g8">
            <h3 style={{ marginBottom: 0 }}>{title}</h3>
            <p className="small muted" style={{ margin: 0 }}>{sub}</p>
            <div className="scroll">
              <table className="team">
                <thead><tr><th>Email</th><th>When</th><th>To</th><th>Sent, last 30 days</th><th></th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.template}>
                      <td><b>{a.name}</b></td>
                      <td>{a.when}</td>
                      <td>{a.to}</td>
                      <td>{a.last30}</td>
                      <td className="actions">
                        <button onClick={() => show(`template=${a.template}`)}>Preview</button>
                        {a.kind === 'automatic' && (
                          <>
                            <span className={`pill ${a.on ? 'ok' : 'fine'}`}>{a.on ? 'On' : 'Off'}</span>
                            <button onClick={() => act({ action: 'email_switch', template: a.template, on: !a.on }, `${a.name}: switched ${a.on ? 'off' : 'on'}.`)}>{a.on ? 'Switch off' : 'Switch on'}</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <h3 style={{ marginBottom: 0 }}>To the team</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {d.team.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="small muted" style={{ margin: 0 }}>Team calendar: {d.teamCalendar ?? 'not set up'}.</p>
      </section>

      <section className="card">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>Sent emails</h2>
          <div className="row">
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="all">All types</option>
              {d.automations.map((a) => <option key={a.template} value={a.template}>{a.name}</option>)}
            </select>
            <input className="search" type="search" placeholder="Search email or subject" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>The last 30 days. Login codes are hidden. Brevo keeps its own log too, under Transactional, then Logs.</p>
        <div className="scroll">
          <table className="team">
            <thead><tr><th>When</th><th>To</th><th>Email</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {log.map((x) => (
                <tr key={x.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{when(x.at)}</td>
                  <td>{x.to}</td>
                  <td>{x.subject}<br /><span className="muted small">{names[x.template] ?? x.template}</span></td>
                  <td><span className={`pill ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span>{x.error && <><br /><span className="small muted">{x.error.slice(0, 120)}</span></>}</td>
                  <td><button onClick={() => show(`id=${encodeURIComponent(x.id)}`)}>View</button></td>
                </tr>
              ))}
              {log.length === 0 && <tr><td colSpan={5} className="muted">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {preview && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={preview.subject} onClick={() => setPreview(null)}>
          <div className="modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <span><b>{preview.subject}</b>{preview.example && <span className="muted small"> · example with made up data</span>}</span>
              <button onClick={() => setPreview(null)}>Close</button>
            </div>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} />
          </div>
        </div>
      )}
    </>
  );
}
