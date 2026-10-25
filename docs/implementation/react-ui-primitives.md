# React UI primitive audit

Work ledger: [#132](https://github.com/ethan-ngai/quorem/issues/132).

All seven anchored-popover consumers use `ui/Popover`: account menu, profile field guidance, password reset, practice filters, question picker, interview invitations and participants. The primitive owns the neutral surface, portal layer, entrance/exit motion, closed-state pointer blocking and reduced-motion fallback. Feature styles retain dimensions and content layout. Nested selects use the higher shared select layer.

Sidebar preview links use `ui/Tooltip` with keyboard focus and right-side placement; expanded labels suppress redundant hints. Existing editor tooltip imports re-export this primitive. Question authoring navigation belongs in the sidebar only, gated by server-provided admin/custom-author capabilities.

`ui/SelectField` now covers typed boolean cases as well as language, settings, participant roles and practice selectors. Trigger props preserve field labels, validation descriptions and blur handling. Native text inputs/textareas remain appropriate for typed editing. Native `details` in stage/method authoring retain disclosure semantics.

Browser draft history, practice execution sign-in and interview lifecycle prompts use `ui/SessionDialog`, sharing dialog chrome, focus trapping, dismissal and pending protection. Existing settings and sidebar dialogs intentionally retain their specialized Radix layouts; other competitive dialogs already share their CSS surface and Radix focus behavior.

Buttons share the existing token classes. Destructive interview actions now share `.destructive-icon` / `.button-destructive-hover`: neutral rest, error hover/focus, short reversible color transitions and reduced-motion support. Invitation login preserves the interview return path.
