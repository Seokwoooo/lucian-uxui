# Porting a Lucian element

Every file from `get` has the same parts:

```html
<!-- Lucian UX/UI Prompt #050 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#050 -->
<!-- Element / ID / What it does / How to use it / Footprint / Needs / Live demo -->
<style> .u050{…} .u050-card{…} </style>          ← every selector starts with .u050
<div class="ux u050"> … </div>                    ← the root; .ux pulls in the shared base rules
<script>
(function () {
  var root = document.currentScript.previousElementSibling;   ← finds the root above
  …
})();
</script>
```

Read **What it does** and **How to use it** before porting. They describe the states and interactions you must preserve.

## 1. Tokens: once per project

Run `tokens` once. It returns the `--ux-*` variables for light and dark plus the `.ux` base rules: box-sizing, font, focus ring and the reduced-motion clamp. Elements depend on both.

- **The project has a theme system** (CSS variables, `data-theme`, a `.dark` class, Tailwind theme, shadcn variables): keep the `.ux` base rules, then define the `--ux-*` names by pointing them at the project's variables, for example `--ux-accent: var(--primary)` and `--ux-surface: var(--card)`. Define them for both the light and the dark selector the project uses. Map every token the ported elements reference. Search each element's CSS for `var(--ux-` and cover them all.
- **No theme system**: add the tokens file as is, once, in global CSS. It switches by `prefers-color-scheme` and honors `[data-theme="light"|"dark"]` on `<html>`.
- **Fonts**: `.ux` sets a Pretendard/system font stack. If the project has its own font, override it with `.ux{font-family:inherit}` or the project's font variable.

## 2. Styles

- Keep the element's CSS as plain CSS: a global stylesheet, a CSS module with `:global(.u050 …)`, a Vue `<style>` or a Svelte `<style>` with `:global()`. **Do not rewrite it as Tailwind utilities.** That changes the design and loses the motion values.
- Keep every rule scoped under `.uNNN`. Do not add global selectors. If the class name could clash, rename the prefix consistently (`.u050` → `.lx-news-card`) in the CSS, the markup and the script.
- Keep sizes, radii, shadows, durations, easing curves and delays exactly. **Footprint: fixed size** elements have a set width and height. Place them in a slot that fits. If one is wider than a 375px screen, the smallest fix is `max-width:100%` on the root plus a check that nothing breaks. Report that change.

## 3. Script by framework

The script expects to run once with `root` pointing at the element. In a component framework, run that body when the component mounts, with `root` set to the mounted element, and **undo everything when it unmounts**:

- remove listeners added to `window` or `document`
- clear `setInterval` and pending `setTimeout` calls
- cancel `requestAnimationFrame` loops
- disconnect `ResizeObserver`, `IntersectionObserver` and `MutationObserver`
- remove `matchMedia` change listeners

Listeners on elements inside `root` disappear with the DOM and need no cleanup. React StrictMode mounts twice in development, so a missing cleanup shows up as doubled behavior.

**React / Next.js**

```tsx
'use client';                       // Next.js App Router: the element is interactive
import { useEffect, useRef } from 'react';
import './lucian-050.css';          // the element's <style> content, unchanged

export function NewsCard() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current!;
    const cleanups: Array<() => void> = [];
    // …the element's script body, with `var root = document.currentScript.previousElementSibling` removed.
    // Wherever it adds a window/document listener, interval, rAF loop or observer, push the undo:
    //   window.addEventListener('pointermove', onMove); cleanups.push(() => window.removeEventListener('pointermove', onMove));
    return () => cleanups.forEach(fn => fn());
  }, []);
  return <div ref={ref} className="ux u050">{/* markup converted to JSX: class→className, for→htmlFor, style strings → objects, self-close void tags */}</div>;
}
```

Drive real data through props. When the script writes text content, such as a count or a label, either keep that DOM write or lift it into state. Do not do both. If you lift state into React, remove the matching DOM write from the effect so the two never disagree.

**Vue**: put the markup in `<template>` with `ref="root"`. Run the script body in `onMounted` and the cleanups in `onBeforeUnmount`.
**Svelte**: use `bind:this={root}` and run the body in `onMount`, returning the cleanup function.
**Astro / plain HTML**: paste the snippet as is. The `document.currentScript` lookup works in a normal inline `<script>`. In Astro, use `<script is:inline>` so it is not bundled and moved. Add the tokens once per page or layout.

## 4. Content and data

- Replace sample copy, names, numbers and emails with the project's real content in the project's language. Keep the copy short enough for the element's layout.
- Keep accessibility as it is: `aria-*`, roles, labels, `tabindex`, keyboard handlers and focus styles.
- Connect real events. Form submits, toggles and selections should call the project's handlers instead of only animating.
- The files contain only the element. The gallery's autoplay demo is not included, so there is nothing gallery-specific to remove.

## 5. License line

Put the element's first line, `<!-- Lucian UX/UI Prompt #ID · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#ID -->`, at the top of the component file. In JS or TS files, use the same text as a `//` or `/* */` comment.

## 6. Check before reporting

- light and dark themes, including a theme switch while the page is open
- 375px wide, with no horizontal scroll
- keyboard only: Tab, Enter, Space, arrows where the element uses them, and a visible focus ring
- `prefers-reduced-motion: reduce`: the feature still works and ends in its final state
- no console errors, and in React no doubled effects after StrictMode remounts
