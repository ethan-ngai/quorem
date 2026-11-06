/** @file LanguageLogo.tsx @description Shared language artwork with optional accessible tooltip. @module ui */
import { Tooltip } from "./Tooltip";
import "./language-logo.css";
import python from "../assets/python-color.svg?url";
import java from "../assets/java.svg?url";
import typescript from "../assets/typescript.svg?url";
import ocaml from "../assets/ocaml.svg?url";
import postgresql from "../assets/postgresql.svg?url";
import type { EditorLanguage } from "../features/editor/editorLanguages";

const logos = { python, java, typescript, ocaml, postgresql };

export function LanguageLogo({
  language,
  tooltip,
}: {
  language: EditorLanguage;
  tooltip?: string;
}) {
  const image = <img className="language-logo" src={logos[language]} alt="" aria-hidden="true" />;
  return tooltip ? (
    <Tooltip content={tooltip}>
      <span className="language-logo-hint" role="img" aria-label={tooltip} tabIndex={0}>
        {image}
      </span>
    </Tooltip>
  ) : (
    image
  );
}
