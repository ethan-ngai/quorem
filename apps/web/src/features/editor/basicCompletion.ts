/** @file basicCompletion.ts @description Browser-only fallback suggestions without type analysis. @module editor */
import {
  completeAnyWord,
  completeFromList,
  ifNotIn,
  type Completion,
} from "@codemirror/autocomplete";
import type { Language } from "@codemirror/language";

export const javaKeywords =
  `abstract assert boolean break byte case catch char class const continue default do double
  else enum extends final finally float for if goto implements import instanceof int interface long
  native new package private protected public return short static strictfp super switch synchronized
  this throw throws transient try void volatile while true false null var record sealed permits yield`
    .split(/\s+/)
    .map((label) => ({ label, type: "keyword" }));

/** Use CodeMirror sources; word suggestions intentionally include names outside the current scope. */
export function basicCompletion(language: Language, words: readonly (string | Completion)[]) {
  const outsideLiterals = [
    "StringLiteral",
    "CharacterLiteral",
    "LineComment",
    "BlockComment",
    "String",
    "Comment",
    "string",
    "comment",
  ];
  return [
    language.data.of({
      autocomplete: ifNotIn(outsideLiterals, completeFromList(words)),
    }),
    language.data.of({ autocomplete: ifNotIn(outsideLiterals, completeAnyWord) }),
  ];
}
