export default function SecurityPage() {
  return (
    <div>
      <h1>How your files are actually protected</h1>
      <p className="subtitle">Not a slogan — the real mechanics, so you can judge for yourself.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>In transit</h3>
        <p>Every upload and download runs over HTTPS/TLS, the same encryption your bank's website uses.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>At rest</h3>
        <p>Files are encrypted on our storage servers. Nobody browses a folder of your files — retrieval only works through a valid, unexpired code.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Zero quality loss, provably</h3>
        <p>
          We hash every file with SHA-256 the moment it's dropped, and check that hash again on every
          download. If even one byte changed, the download would fail the check — it never does,
          because we never re-encode, re-compress, or touch your file after you drop it.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>You control who gets in</h3>
        <p>
          You set how many people can use your code before it stops working. Every code also expires
          on a timer you can see. Nobody can retrieve a file without both the code and enough retrievals
          left.
        </p>
      </div>

      <div className="card">
        <h3>What we don't do</h3>
        <p>We don't sell your files or data. We don't scan documents for ads. We don't ask for your phone number to drop a file.</p>
      </div>
    </div>
  );
}
