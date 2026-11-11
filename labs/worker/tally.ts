// The pre session form in Tally sends every submission here (Tally: form, Integrations, Webhooks).
// Tally signs the body with the signing secret: base64 of HMAC SHA256. Without the right
// signature nothing is stored.

import type { PreForm } from '../core/types';

type TallyOption = { id: string; text: string };
type TallyField = { key: string; label: string | null; type: string; value: unknown; options?: TallyOption[] };
export type TallyPayload = { eventId?: string; eventType?: string; createdAt?: string; data?: { responseId?: string; submissionId?: string; createdAt?: string; fields?: TallyField[] } };

export async function verifyTally(secret: string | undefined, raw: string, sig: string | null): Promise<boolean> {
  if (!secret || !sig) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

// Turns Tally's field list into plain question and answer lines, plus the hidden fields we put in the link.
export function parseTally(p: TallyPayload): (PreForm & { booking: string | null }) | null {
  const d = p.data;
  const id = d?.responseId || d?.submissionId || p.eventId;
  if (!d || !id || !Array.isArray(d.fields)) return null;
  const hidden: Record<string, string> = {};
  const answers: { q: string; a: string }[] = [];
  const files: { name: string; url: string }[] = [];
  let typedEmail = '', typedName = '';
  for (const f of d.fields) {
    const label = (f.label ?? '').trim();
    if (f.type === 'HIDDEN_FIELDS') { if (label) hidden[label.toLowerCase()] = text(f.value); continue; }
    if (typeof f.value === 'boolean' || f.value == null) continue; // checkbox helper fields and unanswered questions
    if (f.type === 'FILE_UPLOAD' && Array.isArray(f.value)) {
      for (const x of f.value as { name?: string; url?: string }[]) if (x?.url) files.push({ name: x.name ?? 'file', url: x.url });
      continue;
    }
    let a = '';
    if (Array.isArray(f.value)) {
      const names = (f.value as unknown[]).map((v) => f.options?.find((o) => o.id === v)?.text ?? text(v)).filter(Boolean);
      a = names.join(', ');
    } else a = text(f.value);
    if (!label || !a) continue;
    if (f.type === 'INPUT_EMAIL' && !typedEmail) typedEmail = a;
    if (/^full name$/i.test(label)) typedName = a;
    answers.push({ q: label, a });
  }
  return {
    id, at: d.createdAt || p.createdAt || new Date().toISOString(),
    email: (hidden.email || typedEmail).toLowerCase(), name: typedName || hidden.name || '',
    booking: hidden.booking || null, answers, files
  };
}
