# Better Auth and account email (#552)

Better Auth and its passkey plugin remain pinned together at 1.7.17. The factory owns sessions, provider linking, credentials and passkey verification. Product roles and permissions stay in the API/PostgreSQL authorization owner.

| Capability                       | Decision                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Username, passkey, JWT           | Existing official plugins; preserve authoritative session checks, explicit linking and verified WebAuthn assurance.                                                                                    |
| Last login method                | Enabled, cookie only. Username login resolves to credentials. Login marks the last available method; the hint never grants identity or assurance. No migration.                                        |
| Email OTP / magic link           | Do not replace email-first setup or add a second login path implicitly. Existing setup verifies email before credentials; sudo codes bind to an existing session.                                      |
| Two factor                       | Useful follow-up: requires enrollment, recovery codes, schema and password/provider/passkey policy together. Merely installing the plugin does not establish an account-wide MFA requirement.          |
| Have I Been Pwned                | Useful follow-up across both custom registration and Better Auth password mutations. The plugin alone misses custom setup. Requires a bounded external-service/failure policy and mocked local checks. |
| Admin / organization / anonymous | Existing domain roles, memberships and guests have authoritative product owners; adding parallel auth-owned permission models would duplicate those policies.                                          |
| Multi-session / cookie cache     | Separate concerns from listing/revoking sessions. Keep database session validation and cache disabled; a device/session management UI can use Better Auth core APIs without another plugin.            |

References: [last login method](https://better-auth.com/docs/plugins/last-login-method), [two factor](https://better-auth.com/docs/plugins/2fa), [compromised passwords and custom flows](https://better-auth.com/docs/plugins/have-i-been-pwned), [core sessions](https://better-auth.com/docs/concepts/session-management).

## Templates and delivery

`apps/auth/src/emails` owns copy, rendering and brand rasterization. React Email renders HTML and derives plain text from the same content. The existing encrypted mail intents, delivery acceptance states, send budgets and provider adapters remain authoritative. SMTP, relay and Cloudflare carry HTML alongside text; relay payload limits and strict field validation still apply.

Six designs cover registration, password reset, email-change confirmation, new-address verification, missing-provider-email verification and sudo codes. All use the supplied logo and outlined wordmark, direct headings, blue actions, flat surfaces and a separate contact/legal footer. Email-safe sRGB values mirror DESIGN.md; light/dark media styles and narrow padding share one owner. Clients without dark-mode CSS retain the light fallback. Brand images are remote PNGs, so clients that block images show Quorem alt text. No tracking pixels.

Sudo integration contract: `accountMailer(mail)(email, code, "Confirm sudo mode", instruction)` converts the six-digit code into explicit encrypted `code` metadata and an empty URL. `VerificationSender` receives `message.code`; rendering validates six digits, shows five-minute expiry and omits link buttons/fallbacks. Other messages carry their URL. Code lifetime/verification remains with the sudo owner (#550).

Ordinary verification preserves its callback and copy; only email-change callbacks redirect to `emailChanged=1`.

## Local preview

From this checkout:

- `vp -C apps/auth run email:dev` → http://localhost:5300 (React Email HMR).
- `vp -C apps/auth run email:mailpit` → six fixtures for `design-preview@quorem.test` at http://localhost:58025. SMTP is hardcoded to loopback port 51025; nothing goes externally. Preview actions are inert fixtures.
- `vp -C apps/auth exec node --experimental-strip-types src/emails/generate-brand.ts` regenerates the light/dark PNGs from the existing marketing SVG outlines. Copies live in web public assets and React Email's static preview directory.

Production HTML references `https://quorem.app/email/quorem-lockup{,-dark}.png`; publish those static assets with the application before enabling the new mail renderer in production. Local fixture mail uses the running preview server's static assets. Native Node uses `.ts`/`createElement` directly, with no runtime TSX loader.

## Validation

Auth/web TypeScript checks, focused rendering/escaping/code-validation/SMTP/relay tests and the Worker dry-run bundle passed. Registration, recovery, social, credential and passkey integrations passed individually against a newly created disposable loopback PostgreSQL database and real Mailpit. Run those protocol suites with fresh schemas: different fixture secrets otherwise leave incompatible encrypted JWKS behind across files. Combined-suite failures from that fixture isolation issue are not a production auth result.

Inspected the live React Email and delivered Mailpit designs, including the 375px preview. The preview theme toggle changes its canvas; the email’s own media query follows the browser color scheme. Dark appearance was visually checked; inbox-specific light/dark rendering remains client validation.
