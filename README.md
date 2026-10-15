# Lucian UX/UI agent skill

Build sites and components with [Lucian UX/UI Prompt](https://lucianlabs.dev/uxui-prompt/) from inside Claude Code, Codex and other coding agents. Ask for a page and say to use lucian-uxui. The agent searches the library, fetches the elements that fit and ports them into your framework and theme.

Every element is dependency-free HTML, CSS and JS with light and dark themes, pointer, touch and keyboard support, and reduced motion. The library has 400 elements today, 200 interface parts and 200 website sections and animations, and keeps growing. New elements reach the skill without a skill update.

[한국어 안내](README.ko.md)

## Install

Any agent that supports Agent Skills (Claude Code, Codex, Cursor and others):

```sh
npx skills add Seokwoooo/lucian-uxui
```

As a Claude Code plugin:

```text
/plugin marketplace add Seokwoooo/lucian-uxui
/plugin install lucian-uxui@lucian-uxui
```

To install by hand, copy `skills/lucian-uxui` into `~/.claude/skills/` for Claude Code or `~/.agents/skills/` for Codex. For a single project, use `.claude/skills/` or `.agents/skills/` instead.

**Requirements:** Node.js 18 or later, and network access to `lucianlabs.dev`. If that fails, the skill falls back to `raw.githubusercontent.com`. Without Node, the agent uses curl.

## Use

Describe what you want and name the skill:

```text
Build a landing page for my coffee subscription: hero, monthly/yearly pricing, FAQ, newsletter sign-up.
Use the lucian-uxui skill and prefer its elements.
```

```text
Add a sign-in screen with lucian-uxui. Keep my existing auth handlers.
```

To use a specific element from the [gallery](https://lucianlabs.dev/uxui-prompt/), give its number or link:

```text
Use lucian-uxui to add element #056 to the pricing section.
```

You can also call it directly: `/lucian-uxui …` in Claude Code (`/lucian-uxui:lucian-uxui` when installed as a plugin) or `$lucian-uxui …` in Codex.

The agent then:

1. reads your project: framework, styling, theme setup and site language
2. splits the page into UI parts and searches the library for each one
3. fetches only the elements it picked, plus the theme tokens
4. ports them to React/Next, Vue, Svelte, Astro or plain HTML, maps the `--ux-*` color tokens to your theme and keeps each element's one-line license comment
5. reports which elements it used, with links to their live demos

Lucian supplies the interactive parts: buttons, toggles, inputs, menus, cards, sign-in forms, toasts, loaders, empty states, charts and app-level tools. The agent builds the page layout around them.

## Languages

Elements come in English (default) and Korean. The agent uses the language of your site's copy. Ask for the other language to override it.

## How it works

The skill is one `SKILL.md`, a porting guide and a small CLI, [`scripts/lucian-uxui.mjs`](skills/lucian-uxui/scripts/lucian-uxui.mjs), with no dependencies. The agent runs it:

| Command | What it does |
|---|---|
| `search pricing toggle` | best matches for one UI part (English or Korean keywords) |
| `list` / `list --category buttons` | categories, or every element in one |
| `get 056 062` | the code of the chosen elements |
| `tokens` | the `--ux-*` light/dark tokens and shared base rules |

The data is a set of static files at `https://lucianlabs.dev/uxui-prompt/api/v1/`, served from a CDN. A copy is mirrored in [Seokwoooo/lucian-uxui-prompt](https://github.com/Seokwoooo/lucian-uxui-prompt/tree/main/api/v1).

| File | Contents |
|---|---|
| `index.json` | version, element count, categories |
| `{en,ko}/catalog.tsv` | one line per element: id, category, title, tags, shape, hash, summary |
| `{en,ko}/e/{id}.txt` | one element: license line, description, `<style>`, markup, `<script>` |
| `{en,ko}/tokens.css` | theme tokens and the `.ux` base rules |

- The catalog is cached for 6 hours and then revalidated with an ETag. Elements are cached by content hash, so a repeat run downloads almost nothing. When the network is down, the cache still works.
- The CLI only downloads these files. It never sends anything about your project. Requests identify themselves with a `lucian-uxui-skill/<version>` user agent.

| Variable | Default |
|---|---|
| `LUCIAN_UXUI_CACHE` | `~/.cache/lucian-uxui` (falls back to the temp folder) |
| `LUCIAN_UXUI_TTL` | `21600` seconds before the catalog is revalidated |
| `LUCIAN_UXUI_BASE` | comma-separated data sources to use instead, such as a local copy |

## License

[MIT](LICENSE) © 2026 Seokwoooo. The elements are MIT-licensed as well. Keep the one-line comment at the top of each ported element.
