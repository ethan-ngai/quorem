# Persistent notices

Tracked in [#503](https://github.com/ethan-ngai/quorem/issues/503).

Use `apps/web/src/ui/PersistentNotice.tsx` for recoverable errors that must remain available. Keep existing feature state; no registration, effects, global store or dismissal state required.

```tsx
<NoticeRegion message={error} label="Could not save">
  <ExistingForm />
</NoticeRegion>
```

`NoticeRegion` reserves a trailing slot beside content. In an existing toolbar, field heading or dialog footer, mount `PersistentNotice` directly. Always mount it, including when `message` is empty: conditional mounting defeats the geometry guarantee. Both use the same fixed-size slot; messages and counts never change its dimensions. Details use the shared portaled Popover, with keyboard dismissal, focus restoration and viewport collision handling.

`message` accepts a string or an array of strings. Empty and duplicate messages are removed. `label` names the issue; `severity` selects error or warning. Optional `actions` provide labeled recovery callbacks. An action does not clear the error: the owning feature clears it after recovery succeeds. Closing details leaves the indicator present. Resolving all messages removes the indicator and details, retaining the slot.

Full messages are announced politely and remain available to assistive technology with details closed. Use `id` to connect a field's `aria-describedby`; retain `aria-invalid` on the field. `NoticeRegion` also associates its content group with the description. Native labels remain owned by existing controls.

Choose the smallest useful scope: field, form, pane or application control. No reserved blank message rows and no floating notification stack. Keep transient events in toasts, page-blocking errors in recovery views, and execution diagnostics in results. A notice summarizes a problem; it does not replace the failed content itself.

Migrated consumers: authoring validation, bulk action errors and save failures, typed test input validation, staged method selection, password reset, social sign-in and email verification, account validation, match catalog feedback, interview question setup/replacement and editor save recovery. Existing toast flows retain their behavior.
