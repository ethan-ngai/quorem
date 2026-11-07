import { LoaderCircle } from "lucide-react";
import "./spinner.css";

export function Spinner({ size = 16, active = true }: { size?: number; active?: boolean }) {
  return (
    <LoaderCircle className="ui-spinner" size={size} data-active={active} aria-hidden="true" />
  );
}
