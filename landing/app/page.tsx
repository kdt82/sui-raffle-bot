const featureCards = [
  {
    title: "Multi-DEX buy detection",
    body:
      "Tracks real swaps on Cetus, Turbos, Kriya, DeepBook, and more. Dual monitoring (Blockberry + native SUI events) ignores wallet-to-wallet transfers so tickets stay honest."
  },
  {
    title: "Interactive admin wizard",
    body:
      "Inline keyboards guide admins through raffle creation, prize setup, and media uploads with back navigation. CLI commands remain available for power users."
  },
  {
    title: "Provably fair winners",
    body:
      "Uses SUI on-chain randomness with verifiable proofs and a secure fallback if randomness is not configured. Weighted draws respect ticket counts."
  },
  {
    title: "Analytics and metrics",
    body:
      "Health endpoints, metrics, and analytics commands give visibility into buy events, leaderboards, raffle comparisons, and CSV exports."
  },
  {
    title: "Notifications and rate limits",
    body:
      "Ticket alerts, winner announcements, and admin pings with Redis-backed rate limiting and anti-spam controls keep chats clean."
  },
  {
    title: "Automated backups",
    body:
      "Full backups before winner selection, downloadable archives, and per-raffle restores protect every drawing."
  },
  {
    title: "Configurable rules",
    body:
      "Set minimum purchase thresholds, adjust tickets manually, and run leaderboards so whales and newcomers both see transparent odds."
  },
  {
    title: "Production ready",
    body:
      "Dockerized Fastify + Prisma stack with health checks, Redis queues, and environment templates for Railway, VPS, or cloud."
  }
];

const steps = [
  {
    title: "Connect & configure",
    body: "Add the Telegram bot, set your token, prizes, and raffle window with the guided admin wizard.",
    badge: "01"
  },
  {
    title: "Track verified buys",
    body: "The bot watches DEX swaps, allocates tickets automatically, and filters out transfers that should not count.",
    badge: "02"
  },
  {
    title: "Pick winners & announce",
    body: "Trigger provably fair selection, create a backup automatically, and broadcast results with proofs and leaderboards.",
    badge: "03"
  }
];

const reliability = [
  "Health, readiness, and liveness probes for production monitoring.",
  "BullMQ workers keep ticket allocation and notifications flowing even under load.",
  "Detailed audit logging across raffle creation, media uploads, and prize awards.",
  "Backups and restores you can trigger from chat for fast recovery."
];

const chips = [
  "Cetus",
  "Turbos Finance",
  "Kriya",
  "DeepBook",
  "Redis rate limiting",
  "Prisma + Postgres",
  "BullMQ queues",
  "Fastify API",
  "Health endpoints",
  "Docker-ready"
];

export default function Page() {
  return (
    <main className="page-shell">
      <div className="floating-glow glow-left" />
      <div className="floating-glow glow-right" />
      <div className="container">
        <header className="header">
          <div className="brand">
            <div className="brand-mark">SR</div>
            <div className="brand-text">
              <div className="brand-name">SUI Raffle Bot</div>
              <div className="brand-sub">by Sutilities | Telegram-first</div>
            </div>
          </div>
          <div className="nav">
            <a className="pill" href="#features">
              Features
            </a>
            <a className="pill" href="#process">
              How it works
            </a>
            <a className="pill" href="#pricing">
              Pricing
            </a>
          </div>
        </header>

        <section className="hero">
          <div>
            <div className="pill">Zero-hassle Telegram experience</div>
            <h1>Automate SUI raffles with zero hassle</h1>
            <p>
              Free raffle bot from the Sutilities team. Track on-chain buys across top SUI DEXes, allocate tickets in real
              time, and pick verifiably fair winners - all without leaving Telegram.
            </p>

            <div className="hero-actions">
              <a className="button primary-button" href="https://t.me" target="_blank" rel="noreferrer">
                Launch Telegram bot
              </a>
              <a className="button ghost-button" href="#docs">
                View docs
              </a>
            </div>

            <div className="hero-footnote">
              <span>Multi-DEX detection: Cetus | Turbos | Kriya | DeepBook</span>
              <span>On-chain randomness with backups before every draw</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="visual-card">
              <div className="visual-tag">
                <span className="icon-badge">TG</span>
                Telegram-first automation
              </div>
              <div className="visual-hero-text">Drop tickets the moment a verified buy lands.</div>
              <div className="visual-grid">
                <div className="visual-bubble">
                  Buy detected
                  <br />
                  <strong>+100 tickets</strong>
                </div>
                <div className="visual-bubble">
                  Method
                  <br />
                  <strong>On-chain randomness</strong>
                </div>
                <div className="visual-bubble">
                  Backups
                  <br />
                  <strong>Pre-draw snapshot</strong>
                </div>
                <div className="visual-bubble">
                  Status
                  <br />
                  <strong>Ready to announce</strong>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="section-header">
            <div className="pill">Simple, predictable pricing</div>
            <h2>Free to run. Keep every ticket.</h2>
            <p>
              No platform fees or monthly charges. Configure your own prize rules and minimum purchase thresholds while
              keeping control of wallets and payouts.
            </p>
          </div>

          <div className="card pricing">
            <div className="pricing-grid">
              <div className="pricing-item">
                <div className="icon-badge">0</div>
                <div className="pricing-value">$0</div>
                <div className="muted">Platform fee</div>
              </div>
              <div className="pricing-item">
                <div className="icon-badge">TK</div>
                <div className="pricing-value">Configurable</div>
                <div className="muted">Prizes, ticket ratios, thresholds</div>
              </div>
              <div className="pricing-item">
                <div className="icon-badge">24/7</div>
                <div className="pricing-value">Always on</div>
                <div className="muted">Health-monitored bot</div>
              </div>
            </div>
            <div className="hero-footnote" style={{ marginTop: 14 }}>
              <span>No hidden costs</span>
              <span>Uses your own RPC and database</span>
              <span>Backups before winner selection</span>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="section-header">
            <div className="pill">Built for SUI communities</div>
            <h2>Everything you need for provably fair raffles</h2>
            <p>
              Production-ready architecture with automated ticketing, verifiable randomness, inline admin controls, and the
              observability you need to keep raffles running smoothly.
            </p>
          </div>

          <div className="grid">
            {featureCards.map((item) => (
              <div className="card feature-card" key={item.title}>
                <div className="icon-badge">*</div>
                <h3>{item.title}</h3>
                <p className="muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="process">
          <div className="section-header">
            <div className="pill">Simple 3-step process</div>
            <h2>Get a raffle live in minutes</h2>
            <p>
              Telegram-native setup with automated ticket allocation and verifiable winner selection. No extra dashboards to
              learn.
            </p>
          </div>

          <div className="steps">
            {steps.map((step) => (
              <div className="card step-card" key={step.title}>
                <div className="icon-badge">{step.badge}</div>
                <h3>{step.title}</h3>
                <p className="muted">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="docs">
          <div className="section-header">
            <div className="pill">Reliability and governance</div>
            <h2>Operational controls baked in</h2>
            <p>
              Every deployment ships with health checks, backups, logging, and analytics so you can ship confidently on
              Railway or any cloud.
            </p>
          </div>

          <div className="card">
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div className="list">
                {reliability.map((item) => (
                  <div key={item} className="pill" style={{ background: "rgba(255,255,255,0.06)" }}>
                    {item}
                  </div>
                ))}
              </div>
              <div>
                <h3>Docs you can rely on</h3>
                <p className="muted">
                  Setup, deployment, rate limiting, notifications, winner selection, analytics, backups, and multi-tenant
                  guidance are covered in the included docs so teams can onboard quickly.
                </p>
                <div className="chips">
                  {chips.map((chip) => (
                    <span className="chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="cta-banner">
          <div className="pill" style={{ margin: "0 auto" }}>
            Ready to automate your raffles?
          </div>
          <h3>Join communities already running provably fair SUI raffles.</h3>
          <p>
            Launch the Telegram bot, set your prize rules, and let automated buy detection, backups, and on-chain
            randomness keep every draw trustworthy.
          </p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <a className="button primary-button" href="https://t.me" target="_blank" rel="noreferrer">
              Start your raffle
            </a>
            <a className="button ghost-button" href="#features">
              Explore features
            </a>
          </div>
        </div>

        <footer className="footer">
          <div>(c) {new Date().getFullYear()} SUI Raffle Bot by Sutilities. All rights reserved.</div>
          <div className="footer-links">
            <a href="#docs">Docs</a>
            <a href="#pricing">Pricing</a>
            <a href="#features">Features</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
