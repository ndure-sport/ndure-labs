/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // The order and consent pages carry a private token in the URL; keep them out of search engines.
          { key: 'X-Robots-Tag', value: 'noindex' }
        ]
      }
    ];
  }
};

export default nextConfig;
