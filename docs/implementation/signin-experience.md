# Sign-in experience (#56)

- Persisted app theme applies before the form renders. Desktop uses a 48/52 split: marketing problem-card examples left, a 400px sign-in form right. Below 900px the showcase is omitted.
- Marketing ProblemCards is ported into an isolated React example. It shows example problem data, never account activity or fabricated stats.
- Original canvas grid uses low-amplitude smooth vertex displacement. It pauses offscreen/hidden, renders static with reduced motion, and has no pointer interaction.
- Username/password retains the existing service contract. Password visibility is local; credentials are never persisted. Social providers are capability-aware; absent credentials produce disabled controls with a clear note.
- Passkey sign-in and account-settings enrollment/list/removal use real WebAuthn endpoints. Browsers without support get an explanation. Authentication uses the server's canonical origin, preserving the return destination.
- Signed-out navigation shows Sign in directly, without a guest avatar/menu. Authenticated profile, photo and theme controls remain available.
- Create account asks only for email, then shows delivery confirmation, Change email and the server-driven resend countdown. The link unlocks username/password setup; successful setup signs in and preserves the safe destination. Expired links offer a new email; verified existing accounts return to sign-in without changes.
- The logo stays at the top left. A compact Back link above the heading returns to the referring app page with its query parameters, and is hidden on direct/external arrivals.
- Guest match creation carries separate back and post-login destinations. Back cancels the consumed creation intent; successful sign-in resumes the dialog once while retaining catalog filters.
- Reset-password, SSO, remember-me and saved-profile flows remain absent until supported by the auth service.
