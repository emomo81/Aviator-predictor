export default function TermsPage() {
  return (
    <div className="legal">
      <h1>Terms of Service</h1>
      <div className="updated">Last updated: September 2026</div>

      <h3>1. What FlightCast is</h3>
      <p>
        FlightCast is a computer-vision and statistical modelling demonstration. It reads a screenshot
        of crash-game history with Gemini (or an offline mock) and turns that history into a 31-value
        feature vector, then into ensemble statistics. It is not a prediction service.
      </p>

      <h3>2. No betting advice</h3>
      <p>
        Crash-style games use a provably-fair random number generator. Each round is independent of
        previous rounds. No historical model can have an edge. FlightCast reports held-out skill vs a
        naive base-rate baseline precisely so you can see that skill is ~0. Do not stake money on its
        outputs.
      </p>

      <h3>3. No warranty</h3>
      <p>
        The service is provided as-is. The model bundle at <code>server/data/model.json</code> is trained
        on public history, evaluated on a held-out 20% split, and shows MAE 0.3184 vs baseline 0.3182
        and AUC 0.4993 vs 0.5000 — i.e., no signal. Use at your own risk.
      </p>

      <h3>4. Privacy</h3>
      <p>
        Screenshots you upload are sent to the API for vision extraction and are not stored unless you
        configure Supabase logging yourself. See <a href="/privacy">privacy policy</a>.
      </p>

      <h3>5. Acceptable use</h3>
      <p>
        Do not use FlightCast to facilitate gambling, to automate betting, or to misrepresent its
        outputs as forecasts. The disclaimer is part of every API response and must remain visible in
        any derivative UI.
      </p>
    </div>
  );
}
