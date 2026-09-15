export default function PrivacyPage() {
  return (
    <div className="legal">
      <h1>Privacy Policy</h1>
      <div className="updated">Last updated: September 2026</div>

      <h3>Data you provide</h3>
      <p>
        When you upload a screenshot, the image is sent to <code>/api/analyze</code> or{' '}
        <code>/api/predict</code>. If <code>GEMINI_API_KEY</code> is configured, the image is forwarded to
        Google Gemini for structured extraction. Otherwise an offline deterministic extractor runs locally.
        Images are not persisted by default.
      </p>

      <h3>What we store</h3>
      <p>
        The open-source deployment stores nothing. If you wire Supabase, you may choose to log
        predictions in the <code>predictions</code> table defined in <code>supabase/schema.sql</code>. That
        is opt-in and requires your own service-role key.
      </p>

      <h3>Model and dataset</h3>
      <p>
        The trained model at <code>server/data/model.json</code> contains only aggregated forest
        parameters and evaluation metrics, not your uploads. The training data is the repository&apos;s{' '}
        <code>multipliers.csv</code> (732,367 rounds).
      </p>

      <h3>Contact</h3>
      <p>
        Open an issue at{' '}
        <a href="https://github.com/emomo81/Aviator-predictor" target="_blank" rel="noreferrer">
          github.com/emomo81/Aviator-predictor
        </a>{' '}
        for privacy questions.
      </p>
    </div>
  );
}
