# UCSD Cannonball

Independent campus time trial at https://ucsdcannonball.com/.

## Source and provenance

The initial site was copied from the public `public/cannonball/` directory in
`BoomerRawlings/boomerrawlings.com`, commit
`ce6dc6793b70efddfd22723a50f6968962e385fc`.
The migration changes only the document's canonical URL and its home link.
The CSS, JavaScript, fonts, images, and transitions are preserved.

This repository's `main` branch is the canonical source for the standalone site.
GitHub Actions validates the site and publishes only its public runtime files to
GitHub Pages. Do not deploy an untracked copy as the lasting production source.

## Development and validation

Use Node.js 24:

    npm ci
    npm test
    npm run build

The build packages the public site in `dist/`. Serve that directory using any
static HTTP server to preview the result. Dependencies and test files are not
included in the deployment artifact.

The tests cover entry gating, standings parsing and ranking, timestamps,
submission handoff, retries, privacy boundaries, and root-domain asset paths.

## Hosting

In the repository's Pages settings, select **GitHub Actions** as the publishing
source and configure `ucsdcannonball.com` as its custom domain. The Pages setting
is authoritative for an Actions deployment. Enable **Enforce HTTPS** after the
certificate is available. Configure the new domain's DNS for GitHub Pages while
preserving unrelated records and its registrar nameservers.

The former `/cannonball/` route on the personal site is maintained separately as
a forward link to this domain. This site has no return link to the personal site.

## Google integration and privacy

The existing public Google spreadsheet remains the source for approved standings
and the submission form URL. `standings.mjs` reads only the `Standings` and `Config`
tabs, without credentials. The site's submission link is loaded from `FormURL` in
`Config`; the form and its review workflow do not require migration.

Never publish the raw submissions/review spreadsheet, GPS evidence, optional
notes, credentials, or other private data. The public board contains only handle,
division, elapsed time, and completion timestamp. Keep form and spreadsheet
permissions unchanged when deploying this site.
