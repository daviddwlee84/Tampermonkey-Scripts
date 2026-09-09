# DOM lifecycle and interaction

Read for SPA behavior, injected UI, keyboard tools, observers, or cleanup.

## Reconcile state, not events

Separate a persistent toolbar/settings shell from route-specific targets and
cached data. Reconciliation finds the current target, compares the desired state,
and changes only what differs. A dataset mark can become stale when a framework
removes your button but retains its parent; check actual UI connectivity too.

| Trigger | Response |
|---|---|
| Initial document becomes usable | Mount once; body may not exist at document-start |
| Target is inserted/replaced | Re-find and reconcile |
| Route identity changes | Invalidate selection, snapshots, pending jobs, stale targets |
| Target disappears during interaction | Cancel and restore a usable state |
| Feature is disabled | Clean up owned listeners/UI, timers and observers |

Observe the smallest stable ancestor. For one-shot waits, query within the same
root you observe, check immediately, impose a timeout, and disconnect on success,
timeout, or cancellation. If the root itself is replaced, rebind from a stable
ancestor. Use `root.querySelector()`, not a document query with a subtree observer.

## Observer feedback and scheduling

MutationObserver callbacks run asynchronously. A flag set before a DOM write and
reset immediately afterwards has reset by callback time. Compare desired state:

```javascript
function reconcileTitle(prefix) {
  if (document.title.startsWith(prefix)) return;
  document.title = prefix + document.title;
}
```

For complex transforms, derive output from a stable source rather than repeatedly
transforming transformed content. Restrict observed attributes and ignore owned
mutations where practical. If disconnecting temporarily, reconcile afterwards
because relevant changes may have been missed.

A trailing debounce can starve on streaming content. Use a throttle, a scheduled
single pass, or a maximum wait when updates must continue. Keep callbacks cheap;
avoid full-document scans per token.

## SPA routes

`pushState`/`replaceState` do not dispatch `popstate`; a URL change need not mutate
the DOM. An observer callback checking `location.href` alone misses such changes.

Default to a verified route signal already used by the project. Otherwise use
`popstate`/`hashchange` plus a low-frequency URL comparison while active, and
check route identity at action time. Suspend/clean up the comparison when
inactive. Manager URL events require compatibility checks. Patching a sandbox's
History methods does not necessarily observe the page's calls.

For asynchronous work, capture the route generation at start; confirm the same
generation and target before applying the result. Cancel on navigation where
possible so a panel/export cannot silently show the previous page.

## UI ownership, focus, and hotkeys

- Namespace IDs, styles and data attributes. Open Shadow DOM can isolate panel
  styles; retain a known host for extraction and testing. It is not a security
  boundary or complete event isolation.
- Put toolbars outside their export region. Preserve selection before toolbar
  focus changes; associate it with the source route.
- Check `event.composedPath()` for input, textarea, select, and editable ancestors.
  Handle inherited contenteditable and Shadow DOM retargeting.
- Ignore composition (`isComposing`, applicable legacy 229), dead keys, and
  inappropriate repeats/modifiers. Test typing with keyboard input; `fill()`
  does not establish shortcut coexistence.
- Call `preventDefault()` only for accepted actions. Scope propagation control
  to owned UI/commands. Cover keypress/keyup if the site reacts to them, while
  preserving editing and IME behavior.
- Provide close/Escape and recovery controls. Restore focus, scroll and overflow;
  avoid hiding the only way to re-enable a feature.
- Check extension shortcuts on the page and inside the panel. Earlier capture
  listeners may win; document the observed limit rather than promising priority.

Synthetic events may fail trusted-user-activation requirements. Browser-level
extension actions, cross-origin frames, and closed Shadow DOM need separate
scope decisions; a top-level DOM test supplies no evidence for them.

## Sources

- [MDN microtasks](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)
- [MDN History.pushState](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState)
- [MDN Window.popstate](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event)
- [Source evidence](provenance.md)
