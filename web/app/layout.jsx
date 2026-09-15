import './globals.css';

export const metadata = {
  title: 'FlightCast — Aviator Analytics Dashboard',
  description:
    'FlightCast: Gemini vision extracts crash-game history, a random forest turns it into honest statistics. No prediction of provably-fair RNG, just transparent analysis.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <div className="brand-mark">FC</div>
              <div className="brand-name">
                FlightCast <span>dashboard / gemini + forest</span>
              </div>
            </div>
            <nav>
              <a href="/" className="active">Dashboard</a>
              <a href="/model">Model</a>
              <a href="/analytics">Analytics</a>
              <a href="/terms">Terms</a>
            </nav>
          </header>
          <div className="main">{children}</div>
          <footer className="footer">
            <div>
              FlightCast is a vision + modelling exercise. Crash rounds are independent RNG —{' '}
              <a href="/terms">read the terms</a>.
            </div>
            <nav>
              <a href="/terms">Terms</a>
              <a href="/privacy">Privacy</a>
              <a href="/model">Model report</a>
              <a href="https://github.com/emomo81/Aviator-predictor" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );
}
