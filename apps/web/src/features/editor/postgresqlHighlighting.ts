/** @file postgresqlHighlighting.ts @description PostgreSQL grammar with identifier-specific shared syntax roles. @module editor */
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { styleTags, tags } from "@lezer/highlight";

export const postgresqlExtensions = sql({
  dialect: PostgreSQL.configureLanguage({
    props: [styleTags({ QuotedIdentifier: tags.name })],
  }),
});
