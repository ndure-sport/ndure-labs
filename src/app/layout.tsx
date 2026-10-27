import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NDURE Labs, sign up',
  description: 'Sign up for a lactate session with the NDURE team at DTU, Kongens Lyngby.',
  robots: { index: false }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
