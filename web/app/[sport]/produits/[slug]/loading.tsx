export default function ProductLoading() {
  return (
    <main id="main">
      <section className="section">
        <div className="container">
          <div className="ik-skel-pd">
            {/* Photo */}
            <div className="ik-skel" style={{ aspectRatio: "1/1", borderRadius: "var(--r-card)" }} />

            {/* Infos */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="ik-skel" style={{ height: 13, width: "40%" }} />
              <div className="ik-skel" style={{ height: 26, width: "85%" }} />
              <div className="ik-skel" style={{ height: 20, width: "35%", marginTop: 4 }} />
              <div className="ik-skel" style={{ height: 14, width: "70%", marginTop: 8 }} />
              <div className="ik-skel" style={{ height: 14, width: "60%" }} />
              <div className="ik-skel" style={{ height: 48, borderRadius: "var(--r-btn-lg)", marginTop: 16 }} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
