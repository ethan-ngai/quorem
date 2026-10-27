import "./route-error.css";

/** Keep routing errors recoverable without exposing internal exception details. */
export function RouteError({ reset }: { reset: () => void }) {
  return (
    <main className="route-error" role="alert">
      <h1>We couldn’t open this page.</h1>
      <p>Please try again, or return to practice.</p>
      <div className="route-error-actions">
        <button className="button button-primary" type="button" onClick={reset}>
          Try again
        </button>
        <a className="button button-secondary" href="/practice">
          Back to practice
        </a>
      </div>
    </main>
  );
}
