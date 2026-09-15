import Link from 'next/link';

export const metadata = { title: 'Privacy policy - Aviator Predictor' };

export default function Privacy() {
  return (
    <main className="legal">
      <h1>Privacy policy</h1>
      <div className="updated">Effective 15 September 2026</div>

      <h3>1. What we collect</h3>
      <p>
        The tool does not require an account and does not ask for your name, email, or payment
        details. The only content you submit is what you choose to send for analysis: a screenshot or
        a list of round multipliers.
      </p>

      <h3>2. How submissions are handled</h3>
      <p>
        Screenshots and histories are used to produce a prediction response and are not written to
        disk or kept in a database by this application. If a Gemini API key is configured, the
        screenshot is forwarded to Google's Gemini API to perform the extraction; that processing is
        covered by Google's privacy policy. If no key is configured, extraction runs entirely on the
        server and no image leaves it.
      </p>

      <h3>3. Cookies and analytics</h3>
      <p>
        The site sets no advertising or tracking cookies and runs no first-party analytics. Next.js
        may emit anonymous build telemetry from the development tooling; that is unrelated to your
        submissions and can be disabled with <code>next telemetry disable</code>.
      </p>

      <h3>4. Data you should avoid sending</h3>
      <p>
        Because screenshots may contain personal information (for example usernames or balances
        visible in a capture), avoid uploading images that contain information you do not want
        processed.
      </p>

      <h3>5. Retention and contact</h3>
      <p>
        Trained models are built from round-history datasets stored on the server and contain no
        images. Questions about privacy can be raised through the repository.
      </p>

      <p style={{ marginTop: 28 }}>
        <Link href="/">Back to the tool</Link>
      </p>
    </main>
  );
}
