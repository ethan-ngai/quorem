/** @file CatalogLayout.tsx @description Shared discovery heading, table and loading surfaces. @module practice */
import type { ReactNode } from "react";
import "./practice.css";

export function CatalogLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="practice-browser">
      <header className="practice-heading">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}
