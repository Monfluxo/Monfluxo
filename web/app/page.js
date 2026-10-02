import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <div className="landing-glow landing-glow-one" />
      <div className="landing-glow landing-glow-two" />

      <nav className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="MONFLUXO home">
          <img src="/monfluxo-mark.svg" alt="" />
          <span>MONFLUXO</span>
        </Link>
        <Link href="/beta" className="landing-nav-cta">Enter Beta</Link>
      </nav>

      <section className="landing-hero">
        <div className="landing-eyebrow"><span /> PRIVATE BETA</div>
        <h1>Follow the money.<br/><em>Understand the flow.</em></h1>
        <p className="landing-lead">On-chain intelligence for Solana. Turn raw wallet history into readable behavior, positions, PnL, creator revenue and actionable signals.</p>
        <div className="landing-actions">
          <Link href="/beta" className="landing-primary">Enter MONFLUXO Beta <span>→</span></Link>
          <a href="#intelligence" className="landing-secondary">Explore the intelligence</a>
        </div>
        <div className="landing-proof">
          <div><strong>10K+</strong><span>transactions reconstructed<br/>from a single wallet</span></div>
          <div><strong>BUY / SELL</strong><span>behavior classified<br/>from raw transactions</span></div>
          <div><strong>PnL</strong><span>positions and token<br/>lifecycles reconstructed</span></div>
        </div>
      </section>

      <section className="landing-intelligence" id="intelligence">
        <div className="landing-section-copy">
          <span className="landing-kicker">WALLET INTELLIGENCE</span>
          <h2>A wallet is more than a list of transactions.</h2>
          <p>MONFLUXO reconstructs what happened, then turns it into a behavioral view you can actually use.</p>
        </div>
        <div className="landing-grid">
          <article><span>01</span><h3>Trading Intelligence</h3><p>Understand buys, sells, token history, entry behavior and realized performance.</p></article>
          <article><span>02</span><h3>Positions & PnL</h3><p>Reconstruct open and closed positions with realized and unrealized PnL.</p></article>
          <article><span>03</span><h3>Creator Revenue</h3><p>Surface creator rewards and revenue flows hidden inside transaction history.</p></article>
          <article><span>04</span><h3>Wallet Relationships</h3><p>Identify funding paths, behavioral overlap and relationships between wallets.</p></article>
        </div>
      </section>

      <section className="landing-next">
        <span className="landing-kicker">THE NEXT LAYER</span>
        <h2>Less noise.<br/>More signal.</h2>
        <div className="landing-tags"><span>Smart Wallet Rankings</span><span>Copytrader Intelligence</span><span>KOL Tracking</span><span>Bundle Detection</span><span>Wallet Signals</span><span>Creator Intelligence</span></div>
      </section>

      <section className="landing-final">
        <img src="/monfluxo-mark.svg" alt="" />
        <h2>MONFLUXO is being built in public.</h2>
        <p>The engine is running. The first layer is ready to explore.</p>
        <Link href="/beta" className="landing-primary">Enter Private Beta <span>→</span></Link>
      </section>

      <footer className="landing-footer"><span>MONFLUXO</span><span>On-chain intelligence for Solana.</span><span>© 2026</span></footer>
    </main>
  );
}
