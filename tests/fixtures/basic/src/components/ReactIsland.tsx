export default function ReactIsland() {
  return (
    <section data-testid="react-island">
      <button type="button" data-testid="react-child-button">
        <span data-testid="react-child-label">React child</span>
      </button>
      <article className="pseudo-card" data-testid="pseudo-card">
        <a
          className="pseudo-stretched-link"
          data-testid="pseudo-stretched-link"
          href="#pseudo-card"
        >
          Pseudo card
        </a>
        <span data-testid="pseudo-rating">4.9</span>
      </article>
      <article className="stack-card" data-testid="stack-card">
        <span data-testid="stack-rating">4.8</span>
        <a
          aria-label="Stack card"
          className="stack-overlay"
          data-testid="stack-overlay"
          href="#stack-card"
        />
      </article>
      <article className="pointer-none-card" data-testid="pointer-none-card">
        <span
          className="pointer-none-rating"
          data-testid="pointer-none-rating"
        >
          4.7
        </span>
      </article>
    </section>
  );
}
