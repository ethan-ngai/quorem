# Unified settings

Issue #67. Global navigation owns one Radix dialog for Profile, Security & login and local preferences. The profile-menu Profile entry opens Profile; Settings opens Appearance; the adjacent workspace shortcut appears only in question workspaces and opens Editor. The category rail and content pane scroll independently, including narrow/short viewports. Dialog focus starts on the selected category and returns to the shortcut (or profile button outside a workspace) after dismissal; existing dialog motion and reduced-motion rules apply.

Profile contains photo/name/username. Security & login contains verified email changes, email-link password resets and passkey enrollment/removal. Pencil editing replaces the value in place with an input and icon actions, preserving row geometry. Username rules float below the input; feedback overlays the dialog without moving content. Photo/passkey loading retains button labels and dimensions. Verification, cooldowns and safe errors remain in place. No credential protocol changes.

`useLocalEditorPreferences` is shared by the workspace and settings outside it. Font size, indentation, wrapping and editor scheme use the existing browser storage keys; no account/API persistence. Theme remains browser-local. Workspace-only Drafts preserves history/import/clear handlers; it is omitted outside a workspace.

Validation: `vp check --fix`; 188 web tests passed (2 skipped). Live Vite at http://localhost:5180 from the root checkout: profile-menu entry, both account sections, local wrap persistence from catalog into workspace (restored afterward), draft controls, light/dark themes, 390px layout and independent scrolling at 390×420. Credential changes and passkey ceremonies were not triggered during this UI verification.

In-place editing verification: desktop Name/Username/Email/Password row rectangles unchanged before/after editing; Email/Password and the following passkey section also retain identical rectangles at 390px. No account values were saved and no credential email or ceremony was triggered.
