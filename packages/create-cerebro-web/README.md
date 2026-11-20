# create-cerebro-web

Starts an online store from the [Cerebro Web](https://github.com/FacundoEquiss/cerebro-web)
template — an open-source Next.js base for the store of any line of business, with an admin panel
and a guide for AI agents.

```bash
npm create cerebro-web@latest my-store
```

It gets the template, asks which line of business the store is in and applies that starting
catalogue, installs the dependencies, starts a fresh git repository and prints the next steps.

Without questions (for scripts and AI agents):

```bash
npm create cerebro-web@latest my-store -- --preset almacen --no-install
```

| Flag | What it does |
|---|---|
| `--preset <name>` | `mixto`, `moda`, `hogar`, `tecnologia`, `almacen`, `gastronomia`, `servicios`, `digital`, `a-medida` |
| `--no-install` | Do not run `npm install` |
| `--no-git` | Do not start a git repository |
| `--yes` | Never ask: take the defaults |
| `--lang en` | Messages in English (default: Spanish) |
| `--ref <name>` | Another branch or tag of the template |

The new store keeps the brain (`cerebro/`), `AGENTS.md`, `CLAUDE.md` and `ROADMAP.md` (the agent
that adapts it reads them), starts its own `CHANGELOG.md` at 0.1.0 and leaves the template's
`packages/` and preset CI behind. If something fails on the way, the folder it made is removed.

Needs Node 20.9+ and either `git` or `tar`. No dependencies. MIT.
