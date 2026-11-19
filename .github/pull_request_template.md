## What changes and why

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

- [ ] `npm run check` (no private brand, dictionaries in step)
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] Looked at it in a real browser, on a phone size and a computer size (screenshots below if the UI changed)

## Checklist

- [ ] Code, comments and commit messages are in English.
- [ ] Every new UI text is in `i18n/es.ts` **and** `i18n/en.ts`.
- [ ] No brand, product, domain, id, phone or real e-mail was added (examples use `example.com`).
- [ ] The browser never sends a price that counts; totals are calculated on the server.
- [ ] Every new admin route checks the session by itself (`requireAdmin` / `requireWriter`).
- [ ] Docs updated in both languages where behaviour changed; `CHANGELOG.md` updated.

## Screenshots
