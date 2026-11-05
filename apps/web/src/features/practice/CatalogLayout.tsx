/** @file CatalogLayout.tsx @description Shared discovery heading, table and loading surfaces. @module practice */
import type { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from "react";
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

export function CatalogTable({
  label,
  heading,
  children,
  className,
}: {
  label: string;
  heading: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <table className={className ? `practice-table ${className}` : "practice-table"}>
      <caption className="sr-only">{label}</caption>
      <thead>{heading}</thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** Keep the title keyboard accessible and leave nested controls in charge of their clicks. */
export function CatalogRow({
  onOpen,
  ...props
}: Omit<ComponentPropsWithoutRef<"tr">, "onClick"> & {
  onOpen?: MouseEventHandler<HTMLTableRowElement>;
}) {
  return (
    <tr
      {...props}
      data-openable={!!onOpen}
      onClick={
        onOpen &&
        ((event) => {
          if (event.target instanceof Element && event.target.closest("a, button, input")) return;
          onOpen(event);
        })
      }
    />
  );
}
