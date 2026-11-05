/** @file ocamlHighlighting.ts @description OCaml lexical refinements around the upstream stream mode. @module editor */
import { StreamLanguage } from "@codemirror/language";
import { oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { tags } from "@lezer/highlight";
import { basicCompletion } from "./basicCompletion";
import { ocamlDocumentation } from "./documentationComments";

const { autocomplete, ...languageData } = oCaml.languageData ?? {};
const language = StreamLanguage.define({
  ...oCaml,
  languageData,
  tokenTable: { variant: tags.atom, label: tags.labelName },
  token(stream, state) {
    const token = oCaml.token(stream, state);
    const text = stream.current();
    // Refine only code tokens; upstream owns strings and nested comment state.
    if (token === "variable") {
      stream.eatWhile(/[\w']/);
      return /^[A-Z]/.test(text) ? "className" : "variableName";
    }
    if (token === "quote") return "variant";
    if (token === "variableName.special") return "label";
    if (token == null && text === "'") {
      if (stream.match(/^(?:[^'\\\r\n]|\\(?:[0-9]{3}|x[0-9a-fA-F]{2}|o[0-7]{3}|.))'/))
        return "character";
      if (stream.match(/^[a-z_][\w']*/)) return "typeName";
    }
    if (token == null && /^[/^$]$/.test(text)) return "operator";
    return token;
  },
});

export const ocamlExtensions = [
  language,
  language.data.of({ documentationComments: ocamlDocumentation }),
  basicCompletion(language, autocomplete as readonly string[]),
];
