/** @file account-email.ts @description Email-safe rendering of the Quorem design language. @module auth */
import { createElement as h, type CSSProperties } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { accountEmails, type AccountEmailKind } from "./content.ts";

// sRGB fallbacks for DESIGN.md tokens: email clients cannot rely on OKLCH or CSS variables.
const palette = {
  background: "#ffffff",
  text: "#1e2023",
  secondary: "#53565b",
  border: "#e4e6e8",
  primary: "#2560d9",
};
const paragraph: CSSProperties = {
  color: palette.text,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
export type AccountEmailProps = {
  kind: AccountEmailKind;
  url: string;
  instruction?: string;
  code?: string;
  assetBaseURL?: string;
};

/** @returns Shared flat, responsive account message; brand images only, no tracking. */
export function AccountEmail({
  kind,
  url,
  instruction,
  code: verificationCode,
  assetBaseURL = "https://quorem.app/email",
}: AccountEmailProps) {
  const content = accountEmails[kind];
  const code = kind === "sudo";
  const footerLink: CSSProperties = { color: palette.secondary, textDecoration: "underline" };
  return h(
    Html,
    { lang: "en" },
    h(
      Head,
      null,
      h("meta", { name: "color-scheme", content: "light dark" }),
      h("meta", { name: "supported-color-schemes", content: "light dark" }),
      h(
        "style",
        null,
        `@media (prefers-color-scheme: dark) { .email-body, .email-frame, .email-content { background:#191b1e!important; } .logo-light { display:none!important; } .logo-dark { display:block!important; } .email-text { color:#e0e2e5!important; } .email-muted { color:#a5a8af!important; } .email-rule { border-color:#303338!important; } .email-link { color:#8bb1ff!important; } } @media only screen and (max-width:600px) { .email-content > tbody > tr > td { padding:32px 24px!important; } .email-frame > tbody > tr > td { padding:16px 8px!important; } }`,
      ),
    ),
    h(
      Preview,
      null,
      `${content.instruction} ${code ? "This code expires in 5 minutes." : "This link expires in one hour."}`,
    ),
    h(
      Body,
      {
        className: "email-body",
        style: {
          backgroundColor: palette.background,
          margin: 0,
          fontFamily: '"Geist Sans", Arial, sans-serif',
        },
      },
      h(
        Section,
        {
          className: "email-frame",
          style: { backgroundColor: palette.background, padding: "48px 16px" },
        },
        h(
          Container,
          {
            className: "email-content",
            style: {
              backgroundColor: palette.background,
              maxWidth: "560px",
              padding: "40px 40px 32px",
            },
          },
          h(
            Link,
            {
              href: "https://quorem.app",
              style: { display: "inline-block", marginBottom: "32px" },
            },
            h(Img, {
              className: "logo-light",
              src: `${assetBaseURL}/quorem-lockup.png`,
              alt: "Quorem",
              width: 195,
              height: 40,
              style: { display: "block", border: 0 },
            }),
            h(Img, {
              className: "logo-dark",
              src: `${assetBaseURL}/quorem-lockup-dark.png`,
              alt: "Quorem",
              width: 195,
              height: 40,
              style: { display: "none", border: 0 },
            }),
          ),
          h(Hr, {
            className: "email-rule",
            style: { borderColor: palette.border, margin: "0 0 32px" },
          }),
          h(
            Heading,
            {
              className: "email-text",
              as: "h1",
              style: {
                color: palette.text,
                fontSize: "24px",
                lineHeight: "30px",
                letterSpacing: "-0.6px",
                fontWeight: 600,
                margin: "0 0 24px",
              },
            },
            content.title,
          ),
          h(
            Text,
            { className: "email-text", style: paragraph },
            instruction ?? content.instruction,
          ),
          h(
            Text,
            { className: "email-muted", style: { ...paragraph, color: palette.secondary } },
            content.detail,
          ),
          code
            ? h(
                Text,
                {
                  className: "email-text",
                  style: {
                    ...paragraph,
                    fontFamily: '"JetBrains Mono", Consolas, monospace',
                    fontSize: "32px",
                    letterSpacing: "8px",
                    fontWeight: 600,
                    margin: "24px 0 32px",
                  },
                },
                verificationCode,
              )
            : h(
                Section,
                { style: { padding: "8px 0 24px" } },
                h(
                  Button,
                  {
                    href: url,
                    style: {
                      backgroundColor: palette.primary,
                      color: "#ffffff",
                      fontSize: "15px",
                      fontWeight: 600,
                      padding: "14px 24px",
                      borderRadius: "6px",
                      textDecoration: "none",
                    },
                  },
                  content.action,
                ),
              ),
          h(
            Text,
            {
              className: "email-muted",
              style: {
                ...paragraph,
                color: palette.secondary,
                fontSize: "12px",
                lineHeight: "18px",
              },
            },
            code
              ? "If you didn’t request this code, ignore this email. Your account has not been changed."
              : "This link expires in one hour. If you didn’t request it, you can ignore this email.",
          ),
          code
            ? null
            : h(
                Section,
                null,
                h(Hr, {
                  className: "email-rule",
                  style: { borderColor: palette.border, margin: "24px 0" },
                }),
                h(
                  Text,
                  {
                    className: "email-muted",
                    style: {
                      ...paragraph,
                      color: palette.secondary,
                      fontSize: "12px",
                      lineHeight: "18px",
                      marginBottom: "8px",
                    },
                  },
                  "Button not working? Copy this link into your browser:",
                ),
                h(
                  Link,
                  {
                    className: "email-link",
                    href: url,
                    style: {
                      color: palette.primary,
                      fontSize: "12px",
                      lineHeight: "18px",
                      wordBreak: "break-all",
                      textDecoration: "underline",
                    },
                  },
                  url,
                ),
              ),
          h(
            Section,
            { style: { marginTop: "32px" } },
            h(Hr, {
              className: "email-rule",
              style: { borderColor: palette.border, margin: "0 0 24px" },
            }),
            h(
              Text,
              {
                style: {
                  fontSize: "12px",
                  lineHeight: "20px",
                  textAlign: "center",
                  margin: "0 0 8px",
                },
              },
              h(
                Link,
                { className: "email-muted", href: "mailto:contact@quorem.app", style: footerLink },
                "contact@quorem.app",
              ),
            ),
            h(
              Text,
              {
                className: "email-muted",
                style: {
                  color: palette.secondary,
                  fontSize: "12px",
                  lineHeight: "20px",
                  textAlign: "center",
                  margin: 0,
                },
              },
              h(
                Link,
                { className: "email-muted", href: "https://quorem.app/privacy", style: footerLink },
                "Privacy",
              ),
              " · ",
              h(
                Link,
                { className: "email-muted", href: "https://quorem.app/terms", style: footerLink },
                "Terms",
              ),
              " · ",
              h(
                Link,
                { className: "email-muted", href: "https://quorem.app", style: footerLink },
                "quorem.app",
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
