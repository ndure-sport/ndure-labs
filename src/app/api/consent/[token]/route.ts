import { db } from '@/lib/db';
import { consentRecord, REQUIRED_CONSENTS } from '@/lib/policy';
import { json, fail } from '@/lib/util';

// The training partner gives their own consent; nobody can consent to health data for someone else.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail('Link not valid.', 404);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request.');
  }
  const consents = body?.consents ?? {};
  for (const k of REQUIRED_CONSENTS) {
    if (consents[k] !== true) return fail('Please tick the readiness check, data consent and terms.');
  }
  const { data, error } = await db()
    .from('orders')
    .update({ partner_consents: consentRecord(consents) })
    .eq('partner_token', token)
    .select('id');
  if (error) return fail('Something went wrong. Try again.', 500);
  if (!data || data.length === 0) return fail('Link not valid.', 404);
  return json({ ok: true });
}
