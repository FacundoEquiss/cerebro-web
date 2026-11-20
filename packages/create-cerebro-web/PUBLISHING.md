# Publishing `create-cerebro-web` to npm

`npm create cerebro-web@latest` only works once this package is on npm. It is **not published
yet**: it needs the npm account of the owner of the project. Until then the working path is
`git clone` (see the README of the repository).

These are the steps, for the owner. The pages of npm change: when a button is not where this
says, follow the official guide — <https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages>.

## Once

1. Create an npm account (or sign in): <https://www.npmjs.com/signup>. Turn on two-factor
   authentication: <https://docs.npmjs.com/configuring-two-factor-authentication>.
2. Check the name is free: `npm view create-cerebro-web` must answer "404 Not Found". If someone
   took it, choose a scoped name (`@your-user/create-cerebro-web`): then the command becomes
   `npm create @your-user/cerebro-web@latest`, and the README and the brain
   (`enlaces.crear` in `cerebro/datos.json`) have to say that instead.
3. On your computer: `npm login`.

## Every release

1. The template must be on the `main` branch of GitHub: the creator downloads it from there
   (`--ref <name>` takes another branch or a tag; both work with git and with the tarball).
2. Set the version in `packages/create-cerebro-web/package.json` (the same as the template).
3. Try it against your local copy, without publishing anything:

   ```bash
   CEREBRO_WEB_TEMPLATE="$PWD" node packages/create-cerebro-web/index.mjs /tmp/try-store --preset moda --no-install
   ```

   and against GitHub (what a real user gets):

   ```bash
   node packages/create-cerebro-web/index.mjs /tmp/try-store-2 --preset moda --no-install
   ```

4. See what would be uploaded: `cd packages/create-cerebro-web && npm pack --dry-run`
   (it must list only `index.mjs`, `README.md` and `package.json`).
5. Publish: `npm publish --access public` (npm asks for the two-factor code).
6. Check it from a clean folder: `npm create cerebro-web@latest prueba -- --yes --no-install`.
7. Only now, change the README (both languages) so the `npm create` command is shown as the first
   way to start, and `git clone` as the alternative.

## To undo

A version cannot be reused. A bad release is deprecated, not deleted:
`npm deprecate create-cerebro-web@<version> "use <newer version>"` —
<https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions>.
