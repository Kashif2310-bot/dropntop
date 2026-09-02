export default function Home() {
  return (
    <div>
      <h1>Send a file. Get a code. That's it.</h1>
      <p className="subtitle">
        No WhatsApp compression. No "please share your Gmail." Full quality, in and out,
        with a code only you control.
      </p>

      <div className="card" style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        <a href="/drop" style={{ flex: 1 }}>
          <button style={{ width: '100%' }}>Drop a file</button>
        </a>
        <a href="/retrieve" style={{ flex: 1 }}>
          <button className="secondary" style={{ width: '100%' }}>Retrieve with a code</button>
        </a>
      </div>

      <div className="card" style={{ marginBottom: 32 }}>
        <span className="badge">Zero quality loss</span>
        <span className="badge">Auto-deletes</span>
        <span className="badge">Set your own access limit</span>
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>
          Every file is checked byte-for-byte on the way in and the way out — what you drop
          is exactly what the other person gets. See how on the <a href="/security">security page</a>.
        </p>
      </div>

      <div className="card">
        <p style={{ marginTop: 0, fontWeight: 600 }}>Also useful for:</p>
        <p style={{ color: 'var(--muted)' }}>
          <a href="/exam">Compressing a photo/signature to an exact KB for an exam form</a>, then
          grabbing it anywhere with a code — or a <a href="/standing/create">standing code for a PG,
          hostel, or print shop</a> that collects submissions any time, no phone number exchanged.
        </p>
      </div>
    </div>
  );
}
