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

The leaderboard uses an honor system: valid submissions publish automatically.
Proof is optional. Runs submitted without proof have no verification label;
submitted proof starts as `Pending verification`. Reviewers can mark a run
`Verified` or `Verification rejected`. Only `Verified` displays a check.
Verification belongs to an individual run, so a faster personal best does not
inherit the status of an older run by the same handle.

The public Google spreadsheet supplies standings and the respondent form URL.
`standings.mjs` reads only `Standings` A:E and `Config` A:B, without credentials.
The exact `Standings` column order is:

| Column | Header | Public value |
| --- | --- | --- |
| A | Handle | Rider's public handle |
| B | Division | `Human-powered` or `Motorized` |
| C | Elapsed seconds | Positive elapsed time in seconds |
| D | Completed at | ISO completion timestamp with UTC offset |
| E | Verification | Blank, `Pending verification`, `Verified`, or `Verification rejected` |

The frontend derives straight-line average speed from elapsed seconds and the
1.05-mile crow-flies distance; it does not add a stored speed column. Ranking
still uses elapsed time, completion timestamp, and handle, with one personal best
per handle and division, regardless of verification status. Unknown status values
are not displayed. During rollout, the reader also accepts legacy four-column
results and a blank fifth header. It retries A:D only for Google's exact missing-E
column error.

The `FormURL` row in `Config` supplies the form's respondent URL. The site embeds
the existing Google Form and keeps an external fallback link. Google handles form
submission; the private validation/review workflow decides which valid fields
reach the public standings. Review decisions change verification labels without
publishing proof or notes.

Never publish the raw submissions/review spreadsheet, proof links or contents,
optional notes, credentials, or other private data. Only the five public fields
above and frontend-derived display values belong on the board. Keep form and
spreadsheet permissions unchanged when deploying this site.
