import type { NavigateWithTransition } from "../app.tsx";

type HomePageProps = {
  onNavigate: NavigateWithTransition;
};

export function HomePage({ onNavigate }: HomePageProps) {
  return (
    <main className="home-page">
      <header className="top-nav nav-right-only">
        <nav>
          <button onClick={() => onNavigate("/login")}>Log in</button>
          <button onClick={() => onNavigate("/request-demo")}>
            Request demo
          </button>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-logo">
          <img src="/vayvyx-logo.png" alt="Vayvyx logo" />
        </div>

        <p className="eyebrow">Construction coordination workspace</p>

        <h1 className="hero-wordmark">
          <span className="hero-word-dark">Va</span>
          <span className="hero-word-blue">yvy</span>
          <span className="hero-word-dark">x</span>
        </h1>

        <p className="slogan">Built for the people keeping projects moving.</p>
      </section>
    </main>
  );
}