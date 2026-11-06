/** @file Table.tsx @description Shared list table semantics, motion and row interaction. @module ui */
import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { useChangeMotion } from "./useChangeMotion";
import "./table.css";

export function Table({
  label,
  heading,
  children,
  className,
  density = "regular",
}: {
  label: string;
  heading: ReactNode;
  children: ReactNode;
  className?: string;
  density?: "regular" | "compact";
}) {
  const rowKeys = Children.toArray(children).map((row) => (isValidElement(row) ? row.key : row));
  const body = useChangeMotion<HTMLTableSectionElement>(JSON.stringify(rowKeys));
  return (
    <table data-density={density} className={className ? `data-table ${className}` : "data-table"}>
      <caption className="sr-only">{label}</caption>
      <thead>{heading}</thead>
      <tbody ref={body} className="motion-reveal">
        {children}
      </tbody>
    </table>
  );
}

/** Keep the title keyboard accessible and leave nested controls in charge of their clicks. */
export function TableRow({
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
          if (
            event.target instanceof Element &&
            event.target.closest(
              "a, button, input, select, textarea, summary, [role=button], [role=checkbox]",
            )
          )
            return;
          onOpen(event);
        })
      }
    />
  );
}
