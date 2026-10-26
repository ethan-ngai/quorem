/** @file LegalPage.tsx @description Shared legal reading surface with Odyssey-inspired section navigation. @module public */
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Mail } from "lucide-react";
import { legalDocuments } from "./legalContent";
import { PublicLayout } from "./PublicLayout";

export function LegalPage({ document: kind }: { document: "privacy" | "terms" }) {
  const document = legalDocuments[kind];
  const [active, setActive] = useState(document.sections[0]!.id);
  const [contentsOpen, setContentsOpen] = useState(false);
  useEffect(() => {
    const update = () => {
      const sections = document.sections.map(({ id }) => window.document.getElementById(id));
      const current = sections
        .filter((section) => section && section.getBoundingClientRect().top <= 160)
        .at(-1);
      const atEnd =
        window.innerHeight + window.scrollY >= window.document.documentElement.scrollHeight - 2;
      setActive(atEnd ? document.sections.at(-1)!.id : (current?.id ?? document.sections[0]!.id));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [document]);
  const other = kind === "privacy" ? "terms" : "privacy";
  return (
    <PublicLayout title={document.title}>
      <main id="main-content" className="legal-main" tabIndex={-1}>
        <div className="legal-heading" id="top">
          <a className="public-back" href="/">
            <ArrowLeft size={14} aria-hidden="true" /> Back to home
          </a>
          <div className="legal-title-row">
            <h1>{document.title}</h1>
          </div>
          <div className="legal-meta">
            <span>Effective October 26, 2026</span>
          </div>
        </div>
        <div className="legal-layout">
          <aside className="legal-sidebar">
            <nav aria-label="On this page">
              <span className="legal-nav-label">On this page</span>
              <button
                className="quiet-button legal-index-toggle"
                aria-expanded={contentsOpen}
                aria-controls="legal-index"
                onClick={() => setContentsOpen(!contentsOpen)}
              >
                On this page <ChevronDown size={14} aria-hidden="true" />
              </button>
              <ol id="legal-index" data-expanded={contentsOpen}>
                {document.sections.map((section, index) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={active === section.id ? "location" : undefined}
                      onClick={() => setContentsOpen(false)}
                    >
                      <span className="legal-step" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span>{section.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <a className="legal-contact" href="mailto:contact@quorem.app">
              <Mail size={14} aria-hidden="true" /> contact@quorem.app
            </a>
          </aside>
          <article className="legal-article" aria-label={document.title}>
            <div className="legal-summary">
              <h2>At a glance</h2>
              <p>{document.summary}</p>
            </div>
            {document.sections.map((section, index) => (
              <section
                className="legal-section"
                id={section.id}
                key={section.id}
                aria-labelledby={`${section.id}-title`}
              >
                <h2 id={`${section.id}-title`}>
                  <span className="legal-section-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.id === "contact" && (
                  <a className="text-link" href="mailto:contact@quorem.app">
                    Email Quorem <ArrowRight size={14} aria-hidden="true" />
                  </a>
                )}
              </section>
            ))}
            <div className="legal-end">
              <a className="public-back" href={`/${other}`}>
                {legalDocuments[other].title} <ArrowRight size={14} aria-hidden="true" />
              </a>
              <a className="public-back" href="#top">
                Back to top <ArrowUp size={14} aria-hidden="true" />
              </a>
            </div>
          </article>
        </div>
      </main>
    </PublicLayout>
  );
}
