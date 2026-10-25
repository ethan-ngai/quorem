import { createContext, useContext } from "react";
import type { EditorLanguage } from "./editorLanguages";
export const QuestionLanguage = createContext<EditorLanguage>("python");
export const useQuestionLanguage = () => useContext(QuestionLanguage);
