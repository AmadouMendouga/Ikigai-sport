export default function BoutiqueLoading() {
  return (
    <main id="main">
      <div className="page-hero ik-skel" style={{ minHeight: 110, borderRadius: 0 }} />

      <section className="section">
        <div className="container">
          <div className="product-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="ik-skel-card">
                <div className="ik-skel" style={{ aspectRatio: "1/1" }} />
                <div className="ik-skel-body">
                  <div className="ik-skel" style={{ height: 14, width: "80%" }} />
                  <div className="ik-skel" style={{ height: 13, width: "55%" }} />
                  <div className="ik-skel" style={{ height: 18, width: "40%", marginTop: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
