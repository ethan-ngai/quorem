import python from "../assets/python-color.svg";
import java from "../assets/java.svg";
import typescript from "../assets/typescript.svg";
import ocaml from "../assets/ocaml.svg";
import type { EditorLanguage } from "../features/editor/editorLanguages";

const logos = { python, java, typescript, ocaml };

export function LanguageLogo({ language }: { language: EditorLanguage }) {
  return <img className="language-logo" src={logos[language]} alt="" aria-hidden="true" />;
}
