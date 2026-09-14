import './globals.css';

export const metadata = {
  title: 'Aviator Predictor - vision + ML pipeline',
  description:
    'Gemini reads a crash-game screenshot, the extracted history feeds a random forest. Statistical analysis tool, not a way to beat an RNG.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
