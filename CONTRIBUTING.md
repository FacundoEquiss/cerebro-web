# Contributing

Thanks for wanting to improve Cerebro Web. This project has one goal: that a person who does not
program — with the help of an AI agent — can own a real, working business website. Every
contribution is measured against that.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Run it

Node 22.

```bash
npm install
npm run dev          # http://localhost:3000 and http://localhost:3000/admin
```

With nothing configured it runs in demo mode (demo catalogue, example orders, a read-only demo
user shown on the admin login). To write from the panel locally, create a user with
`npm run admin:hash` and put `ADMIN_USERS` and `ADMIN_SESSION_SECRET` in `.env.local`.

## What a pull request must pass

```bash
npm run check        # no private brand anywhere (template only); es/en dictionaries in step
npm run typecheck    # TypeScript, strict
npm test             # unit tests, including the real SQL on an in-process PostgreSQL
npm run build
npm run test:e2e     # the production build in a real browser, phone and computer
```

The end-to-end tests use the browser Playwright downloads: run `npx playwright install chromium`
once. To use a Chromium already on the machine, set `PLAYWRIGHT_CHROMIUM_PATH` to its path.

CI runs exactly these. If you changed the UI, look at it on a phone size and a computer size and
attach screenshots (`npm run screenshots` takes them and fails on console errors).

## Conventions

- **English** for code, identifiers, comments and commit messages.
- **Bilingual docs**: every `X.md` has an `X.es.md`, linked to each other on the first line. The
  brain (`cerebro/`) is in Spanish.
- **UI texts** live in `i18n/es.ts` and `i18n/en.ts` — never hard-coded in a component. Both must
  have the same keys and placeholders (`npm run check`).
- **Generic, always.** No brand, product, domain, account id, phone or real e-mail. Examples use
  `example.com`. Country-specific rules go behind configuration, not into the core.
- **The server sets the price.** The browser sends ids and quantities.
- **Only through the adapters.** No page or route talks to a database or a gateway directly.
- **No platform lock-in.** It must keep running with `next start` on any Node server.
- **Small dependency surface.** No CSS framework, no UI library, no heavy charting library. A new
  dependency needs a reason in the pull request.
- **Styling**: CSS variables from `config/brand.ts` + CSS Modules; mobile first; one breakpoint
  (768 px); respect `prefers-reduced-motion`. Icons from `lucide-react`.
- **Accessibility**: real buttons and links, labels on every field, visible focus, keyboard
  access to everything, 44 px touch targets.
- **Tests with the change.** A bug fix comes with the test that would have caught it.
- **Commits**: imperative mood, what and why (`Add SMTP mail adapter`). One logical change each.
- **Versioning**: SemVer. Add your change to `CHANGELOG.md` under "Unreleased".

## Keeping your own brand out: `.brand-blocklist`

This scan protects **the template's repository**. It runs in the template's CI
(`GITHUB_REPOSITORY`) and on any machine that has a `.brand-blocklist`; anywhere else — a store
made from the template, its build, its CI — `npm run check` skips it and says so, because a real
store keeps its real contact and bank details in `config/`. It is not part of `npm run build`.

When it runs, it looks for generic leaks in every file: long numbers (account ids, phones),
measurement and project ids, e-mail addresses that are not `example.com`.

If you **derive this template from your own store** — or contribute back from a private fork —
you can also give it your own words to catch (the brand, the owner's name, product names,
domains). Create a file named `.brand-blocklist` at the root of the repository:

```text
# one term per line; accents and case are ignored
my brand name
mydomain
# "=" matches a whole word only (for short words that appear inside others)
=acme
```

- The file is in `.gitignore` and **must never be committed**. Do not put those terms in the
  repository in any other form either — encoded and hashed lists can be reversed.
- `BRAND_BLOCKLIST_FILE=/path/to/file` uses a file somewhere else.
- In the template's CI (no file there) only the generic patterns run, and the script says so.
- The brain builder (`npm run brain`) reads the same file.
- To check the git history too: `git log -p --all --format=%s | node scripts/check-brand.mjs --stdin`.

## Adding an adapter

The contracts and the guarantees each one must keep are in [`docs/adapters.md`](docs/adapters.md).
In short:

1. Implement the interface (`DataAdapter`, `PaymentAdapter`, `MailAdapter`, `StorageAdapter` or
   `AntibotAdapter`) in its folder under `lib/`.
2. Register it in that folder's `index.ts` and add its name to the matching enum in `lib/env.ts`.
3. Validate its variables in `lib/env.ts` and explain them in `.env.example`.
4. Test it without the network: pure functions for signatures and mapping, and for a data adapter
   the guarantees listed in the docs.
5. Document it in `docs/adapters.md` **and** `docs/adapters.es.md`.

A payment adapter must verify its webhook signature before anything else and must never mark an
order as paid without comparing the amount.

## Changing the brain

Edit `cerebro/datos.json`, run `npm run brain` and commit the regenerated `cerebro/dist/`. The
builder fails on a forbidden word, a duplicated id or an empty required field.

## Reporting bugs and proposing ideas

Use the issue templates. Security problems: **not** in a public issue — see [SECURITY.md](SECURITY.md).

## Licence

Your contributions are released under the [MIT License](LICENSE).
