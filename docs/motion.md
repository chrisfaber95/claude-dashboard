# UI motion

How things move in the dashboard: panels, popups, lists, values and scenes (`docs/isometric.md`). The tab stays open
all day, so motion has to be cheap as well as clear.

## Rules

- Animate only `transform` and `opacity`. Filters (blur, drop shadows) only on layers that don't move (also in
  "UI conventions", `docs/architecture.md`).
- CSS does the moving: transitions, keyframes and Vue's `<Transition>` / `<TransitionGroup>`. No
  `requestAnimationFrame` loops or JS tweening for UI.
- Animations always run. Don't add `prefers-reduced-motion` rules: the user chose this, and Windows "Animation
  effects" is off on this PC, which would freeze every animation that sits behind such a rule.
- Motion explains a change: something arrived, left, moved or changed state. Nothing moves just to be busy.
- Nothing loops forever unless it shows a live state (the Root and Co-pilot skins' ambient effects pre-date this
  guide). An infinite animation costs CPU all day: measure it with `scripts/measure-cpu.mjs` (`docs/perf.md`) before
  and after, and keep it to a handful of elements.
- When nothing changes, nothing runs: no running animation, no timer. A test asserts this where a feature animates
  on data (see T-091's city test).

## Timing

Use these tokens, not one-off numbers. They are CSS custom properties on `:root` in `style.scss` (SCSS variables don't
reach partials loaded with `meta.load-css`):

```scss
:root {
  --motion-fast: 120ms;   // hover, press, small state flips
  --motion-base: 200ms;   // popups, panels, list items entering
  --motion-slow: 400ms;   // layout changes, scene changes
  --ease-out: cubic-bezier(0.2, 0, 0, 1);       // things arriving
  --ease-in: cubic-bezier(0.4, 0, 1, 1);        // things leaving
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); // things moving from A to B
}
```

- Arrive with `--ease-out`, leave faster with `--ease-in` (leaving is one step shorter: base in, fast out), move with
  `--ease-in-out`. A walker in a scene is the exception: it walks at a steady pace (`linear`).
- Small things move short distances: 4 to 8 px for a popup or a row, never more than about a third of the element.

## Patterns

**Popup or panel appears.** Popups render only while open (`v-if`), which is exactly what `<Transition>` needs:

```vue
<Transition name="rise">
  <section v-if="open" class="popup">…</section>
</Transition>
```

```scss
.rise-enter-active {
  transition: opacity var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out);
}

.rise-leave-active {
  transition: opacity var(--motion-fast) var(--ease-in), transform var(--motion-fast) var(--ease-in);
}

.rise-enter-from,
.rise-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
```

**Rows arrive, leave or reorder** (feed, session list): `<TransitionGroup>` around the keyed `v-for`, with the same
enter and leave classes plus a `-move` class (`transition: transform var(--motion-base) var(--ease-in-out)`) so the
other rows slide instead of jumping. Keys must be the item's identity, never the index, or every push animates.

**A value or state changes** (a count, idle to active): key a small element on the value, and give it a one-shot
keyframe animation. It runs once when the value really changes and not on the 2 s state pushes that bring the same
value:

```vue
<span :key="count" class="pop">{{ count }}</span>
```

**Hover and press:** `transition: transform var(--motion-fast) var(--ease-out)` and a 1 to 2 px lift or a 0.98 scale.
No colour fades on large areas; a colour change is instant or rides along on `opacity`.

**Something travels** (a message from one session to another): an element moved with keyframes from one point to the
other, end points as custom properties. In an isometric scene use walk steps (`docs/isometric.md`); in a flat view use
the postman pattern in `features/messages/_city.scss`.

**First render:** no entrance animations when the page loads; motion is for changes after that. Vue's `<Transition>`
already skips the first render unless you add `appear`; don't add it.

## Testing

- Vue Test Utils stubs `<Transition>` and `<TransitionGroup>` by default, so component tests see the end state at
  once. Test that the element is there or gone, not the animation.
- Where a feature must not run anything while idle, test that: no element with an animation class, no timer.
- Look at it in a real browser in light and dark before handing off; headless tests can't see timing.
