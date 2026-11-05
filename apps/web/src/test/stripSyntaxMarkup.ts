/** Keep structural assertions independent of how the tokenizer splits source into spans. */
export function stripSyntaxMarkup(html: string) {
  return html.replace(/<span class="code-[^"]+">([^<]*)<\/span>/g, "$1");
}
