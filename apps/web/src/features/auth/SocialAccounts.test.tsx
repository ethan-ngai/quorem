import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SocialAccounts } from "./SocialAccounts";
import { PasswordResetSetting } from "./PasswordResetSetting";

it("lists connections, offers configured providers, and protects the last sign-in method", () => {
  const client = new QueryClient();
  client.setQueryData(["auth-capabilities"], { providers: ["google", "github", "apple"] });
  client.setQueryData(["account-connections", "fixture"], [{ id: "social", providerId: "google" }]);
  const render = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <SocialAccounts userId="fixture" />
      </QueryClientProvider>,
    );
  const html = render();
  expect(html).toContain("Google");
  expect(html).toContain("Connected");
  expect(html).toContain("Connect GitHub");
  expect(html).not.toContain("Apple");
  expect(html).toMatch(/disabled=""[^>]*aria-label="Disconnect Google"/);
  expect(html).toContain(
    "Disconnect Google unavailable. Add a password or another sign-in method before disconnecting.",
  );
  expect(html).not.toContain(
    "Add a password or another connection before disconnecting your only sign-in method.",
  );
  client.setQueryData(
    ["account-connections", "fixture"],
    [
      { id: "social", providerId: "google" },
      { id: "password", providerId: "credential" },
    ],
  );
  expect(render()).not.toMatch(/disabled=""[^>]*aria-label="Disconnect Google"/);
  client.setQueryData(
    ["account-connections", "fixture"],
    [
      { id: "social", providerId: "google" },
      { id: "github", providerId: "github" },
    ],
  );
  expect(render()).not.toMatch(/disabled=""[^>]*aria-label="Disconnect Google"/);
});

it("shows an absent password honestly", () => {
  const html = renderToStaticMarkup(
    <PasswordResetSetting email="fixture@example.test" hasPassword={false} />,
  );
  expect(html).toContain("Not set");
  expect(html).not.toContain("••••••••");
});
