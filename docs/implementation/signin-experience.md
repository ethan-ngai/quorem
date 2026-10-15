# Sign-in experience (#56)

- Persisted app theme applies before the form renders. Desktop uses a 48/52 split: marketing problem-card examples left, a 400px sign-in form right. Below 900px the showcase is omitted.
- Marketing ProblemCards is ported into an isolated React example. It shows example problem data, never account activity or fabricated stats.
- Original canvas grid uses low-amplitude smooth vertex displacement. It pauses offscreen/hidden, renders static with reduced motion, and has no pointer interaction.
- Username/password retains the existing service contract. Password visibility is local; credentials are never persisted. Social providers are capability-aware; absent credentials produce disabled controls with a clear note.
- Passkey sign-in and account-settings enrollment/list/removal use real WebAuthn endpoints. Browsers without support get an explanation. Authentication uses the server's canonical origin, preserving the return destination.
- Signed-out navigation shows Sign in directly, without a guest avatar/menu. Authenticated profile, photo and theme controls remain available.
- Create account switches the credential form to username/email/password; the username becomes the initial display name. Registration requires the server capability and configured verification delivery. Accepted registration clears the password and shows Check your email, resend, and Back to sign in. Verification returns to sign-in while preserving the safe destination.
- The logo stays at the top left. A compact Back link above the heading returns to the referring app page with its query parameters, and is hidden on direct/external arrivals.
- Guest match creation carries separate back and post-login destinations. Back cancels the consumed creation intent; successful sign-in resumes the dialog once while retaining catalog filters.
- Reset-password, SSO, remember-me and saved-profile flows remain absent until supported by the auth service.
