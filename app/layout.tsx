import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "drop'n'top — send files without WhatsApp, without losing quality",
  description:
    'Drop a file, get a code. Anyone with the code can retrieve it at full quality — no app, no account, no compression.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            drop<span className="accent">'n'</span>top
          </a>
          <nav>
            <a href="/drop">Drop</a>
            <a href="/retrieve">Retrieve</a>
            <a href="/security">Security</a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Built in India, for India. Your files are never sold, never scanned for ads, and auto-delete on schedule.
        </footer>
      </body>
    </html>
  );
}
