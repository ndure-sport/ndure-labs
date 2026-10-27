// Leave the page (e.g. to Stripe Checkout). The demo build sets window.__ndureNavigate
// so it can show its own fake payment screen instead of leaving.
export function navigate(url: string) {
  const hook = (globalThis as unknown as { __ndureNavigate?: (u: string) => void }).__ndureNavigate;
  if (hook) hook(url);
  else window.location.href = url;
}
