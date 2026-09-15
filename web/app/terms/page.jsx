import Link from 'next/link';

export const metadata = { title: 'Terms of service - Aviator Predictor' };

export default function Terms() {
  return (
    <main className="legal">
      <h1>Terms of service</h1>
      <div className="updated">Effective 15 September 2026</div>

      <h3>1. What this is</h3>
      <p>
        Aviator Predictor is a research and demonstration tool that applies computer vision and
        statistical modelling to a history of crash-game rounds you provide. It is offered for
        education and evaluation. It produces descriptive statistics and model outputs, and it makes
        no promise about future game results.
      </p>

      <h3>2. No gambling or financial advice</h3>
      <p>
        Nothing on this site is gambling, betting, investment, or financial advice. Crash-style games
        use provably-fair random number generators, so past rounds do not predict future rounds and
        the outputs here cannot give you an edge. You must not rely on them to place wagers or make
        financial decisions. Gambling involves substantial risk of loss; if you gamble, do so only
        for entertainment and with money you can afford to lose.
      </p>

      <h3>3. Acceptable use</h3>
      <p>
        You agree to use the service only with data you have the right to process, to not attempt to
        disrupt or overload it, and to not present its outputs to others as a prediction or betting
        system. You are responsible for how you use the outputs.
      </p>

      <h3>4. Third-party models</h3>
      <p>
        If a Gemini API key is configured, screenshots you submit are transmitted to Google's Gemini
        API for structured extraction, and are governed by Google's terms and privacy policy in
        addition to ours. If no key is configured, an offline extractor runs locally and nothing
        leaves the server.
      </p>

      <h3>5. No warranty, limitation of liability</h3>
      <p>
        The service is provided as is, without warranty of any kind. To the maximum extent permitted
        by law, we are not liable for any loss or damage arising from use of the service, including
        losses from decisions made in reliance on its outputs.
      </p>

      <h3>6. Changes</h3>
      <p>
        We may update these terms. Continued use after a change constitutes acceptance. Questions
        about these terms can be raised through the repository.
      </p>

      <p style={{ marginTop: 28 }}>
        <Link href="/">Back to the tool</Link>
      </p>
    </main>
  );
}
