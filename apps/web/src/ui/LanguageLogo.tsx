import python from "../assets/python-color.svg?url";
import java from "../assets/java.svg?url";
import typescript from "../assets/typescript.svg?url";
import ocaml from "../assets/ocaml.svg?url";
import type { EditorLanguage } from "../features/editor/editorLanguages";

const logos = { python, java, typescript, ocaml };

export function LanguageLogo({ language }: { language: EditorLanguage }) {
  if (language === "postgresql")
    return (
      <span className="language-logo" aria-hidden="true">
        SQL
      </span>
    );
  return <img className="language-logo" src={logos[language]} alt="" aria-hidden="true" />;
}
