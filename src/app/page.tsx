import { loadPricing } from '@/lib/pricing';
import { SignUp } from '@/components/SignUp';

export const dynamic = 'force-dynamic';

// Deep links from the Framer page or ads preselect the basket, for example:
//   book.ndure.dk/?qty=5&src=instagram
//   book.ndure.dk/?partner=1&src=club_newsletter
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const config = await loadPricing();
  const src = (one('src') ?? one('utm_source'))?.slice(0, 60) ?? null;
  const qty = Number.parseInt(one('qty') ?? '1', 10);
  return (
    <SignUp
      config={config}
      src={src}
      cancelled={one('cancelled') === '1'}
      initialQty={Number.isFinite(qty) ? qty : 1}
      initialPartner={one('partner') === '1'}
    />
  );
}
