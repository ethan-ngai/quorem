import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./disclosure.css";

/** Native disclosure preserves child state and uses shared reduced-motion transitions. */
export function Disclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="disclosure settings-disclosure">
      <summary>
        <ChevronRight size={16} className="disclosure-chevron" aria-hidden="true" />
        <span>{title}</span>
        {summary && <small>{summary}</small>}
      </summary>
      <div className="settings-disclosure-content">{children}</div>
    </details>
  );
}
