import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProfileEditor } from "./ProfileEditor";

function render(section: "profile" | "security") {
  const client = new QueryClient();
  client.setQueryData(["auth-capabilities"], { method: "password", registration: true });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProfileEditor
        section={section}
        userId="fixture"
        profile={{ name: "", username: "alice", email: "alice@example.test" }}
      />
    </QueryClientProvider>,
  );
}
it("keeps profile read-only and excludes credential fields", () => {
  const html = render("profile");
  expect(html).toContain('aria-label="Edit name"');
  expect(html).toContain('aria-label="Edit username"');
  expect(html).toContain("Not set");
  expect(html).not.toContain('aria-label="Edit email"');
  expect(html).not.toContain('aria-label="Edit password"');
  expect(html).not.toContain("<input");
});
it("keeps email/password under security without identity editing", () => {
  const html = render("security");
  expect(html).toContain('aria-label="Edit email"');
  expect(html).toContain('aria-label="Edit password"');
  expect(html).not.toContain('aria-label="Edit name"');
  expect(html).not.toContain('aria-label="Edit username"');
  expect(html).not.toContain("<input");
});
