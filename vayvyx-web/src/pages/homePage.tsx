import type { NavigateWithTransition } from "../app.tsx";

type HomePageProps = {
  onNavigate: NavigateWithTransition;
};

export function HomePage({ onNavigate }: HomePageProps) {
  function scrollToPublicSection() {
    document.getElementById("public-overview")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <main className="home-page">
      <header className="top-nav nav-right-only">
        <nav>
          <button type="button" onClick={scrollToPublicSection}>
            Overview
          </button>

          <button type="button" onClick={() => onNavigate("/login")}>
            Log in
          </button>

          <button type="button" onClick={() => onNavigate("/request-demo")}>
            Request demo
          </button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-logo">
          <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
        </div>

        <p className="eyebrow">Private beta coordination workspace</p>

        <h1 className="hero-wordmark">
          <span className="hero-word-dark">Va</span>
          <span className="hero-word-blue">yvy</span>
          <span className="hero-word-dark">x</span>
        </h1>

        <p className="slogan">
          Construction coordination, simplified for project-focused teams.
        </p>

        <p className="hero-status-line">
          Controlled access • Private beta • Built for project coordination
        </p>

        <div className="hero-actions">
          <button
            className="hero-primary-button"
            type="button"
            onClick={() => onNavigate("/request-demo")}
          >
            Request private access
          </button>

          <button
            className="hero-secondary-button"
            type="button"
            onClick={scrollToPublicSection}
          >
            Learn more
          </button>
        </div>
      </section>

      <section id="public-overview" className="public-section">
        <div className="public-section-inner">
          <div className="public-intro">
            <p className="eyebrow">Public overview</p>

            <h2>A focused workspace for construction coordination.</h2>

            <p>
              Vayvyx is being developed as a private beta workspace for helping
              project teams organize important information, follow-ups, and
              coordination workflows in one cleaner system.
            </p>
          </div>

          <div className="public-card-grid">
            <article className="public-card">
              <span className="public-card-number">01</span>

              <h3>Organized project information</h3>

              <p>
                Keep key project details, records, and coordination notes easier
                to find, review, and act on.
              </p>
            </article>

            <article className="public-card">
              <span className="public-card-number">02</span>

              <h3>Cleaner follow-up tracking</h3>

              <p>
                Reduce scattered notes, disconnected trackers, and missed action
                items with a more structured workspace.
              </p>
            </article>

            <article className="public-card">
              <span className="public-card-number">03</span>

              <h3>Controlled beta access</h3>

              <p>
                User accounts and license-based access keep early testing
                private, intentional, and limited to approved users.
              </p>
            </article>
          </div>

          <div className="beta-panel">
            <div>
              <p className="eyebrow">Private beta</p>

              <h2>Built quietly, tested intentionally.</h2>

              <p>
                Vayvyx is currently in controlled development. Access is limited
                while the core product is tested, refined, and shaped through
                real workflow feedback.
              </p>
            </div>

            <div className="beta-panel-actions">
              <button
                className="hero-primary-button"
                type="button"
                onClick={() => onNavigate("/request-demo")}
              >
                Request demo
              </button>

              <button
                className="hero-secondary-button"
                type="button"
                onClick={() => onNavigate("/login")}
              >
                Log in
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}