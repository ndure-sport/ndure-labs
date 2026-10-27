import { NextResponse, type NextRequest } from 'next/server';

// Password protects the team page /admin with HTTP basic auth.
export function proxy(req: NextRequest) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass || pass === 'change-me') {
    return new NextResponse('Admin is disabled until ADMIN_USER and ADMIN_PASSWORD are set.', { status: 503 });
  }
  const header = req.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = atob(encoded).split(':');
    if (u === user && rest.join(':') === pass) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="NDURE Labs admin"' }
  });
}

export const config = { matcher: ['/admin/:path*'] };
