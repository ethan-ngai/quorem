/** @file NotFoundPage.tsx @description Missing-route recovery with an interrupted Odyssey path. @module public */
import { ArrowRight, House } from "lucide-react";
import { PublicLayout } from "./PublicLayout";

export function NotFoundPage() {
  return (
    <PublicLayout title="Page not found">
      <main id="main-content" className="not-found-main" tabIndex={-1}>
        <div className="not-found-content">
          <div className="not-found-path" aria-hidden="true">
            <span>4</span>
            <i />
            <span className="not-found-zero">0</span>
            <i />
            <span>4</span>
          </div>
          <p className="not-found-code">404 / PAGE NOT FOUND</p>
          <h1>This path ends here.</h1>
          <p>
            The page may have moved, or the link may be incomplete.
            <br className="not-found-break" /> There’s more to explore in your workspace.
          </p>
          <div className="not-found-actions">
            <a className="button button-primary" href="/practice">
              Back to practice <ArrowRight size={15} aria-hidden="true" />
            </a>
            <a className="button button-secondary" href="/">
              <House size={15} aria-hidden="true" /> Go home
            </a>
          </div>
        </div>
      </main>
    </PublicLayout>
  );
}
