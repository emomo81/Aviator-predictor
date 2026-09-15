import './globals.css';

export const metadata = {
  title: 'Aviator Predictor: vision plus a random forest',
  description:
    'Gemini reads a crash-game screenshot and the extracted round history feeds a random forest. Every estimate is scored against a naive baseline, and on provably-fair games that score sits at zero.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
