/** @file SiteFooter.tsx @description Shared legal links for application and marketing pages. @module ui */
import "./site-footer.css";

export function SiteFooter({ pathname = "" }: { pathname?: string }) {
  return (
    <footer className="site-legal-footer">
      <div className="site-legal-footer-inner">
        <span>© {new Date().getFullYear()} Quorem</span>
        <nav aria-label="Legal">
          <a href="/privacy" aria-current={pathname === "/privacy" ? "page" : undefined}>
            Privacy Policy
          </a>
          <a href="/terms" aria-current={pathname === "/terms" ? "page" : undefined}>
            Terms of Service
          </a>
          <a href="mailto:contact@quorem.app">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
