# Immersive Genealogy Story Preview

A separate browser-based Story Preview Beta. It reads a GEDCOM locally and lets a visitor choose up to three eligible historical people, read an evidence-grounded story, explore clearly labelled context and an interactive research question, and give accuracy, realism, interest and immersive-potential feedback.

Website address after deployment: https://alexanderjackson1982-boop.github.io/immersive-genealogy-story-preview/

## Privacy

The website and this source code will be public after owner approval. The visitor's GEDCOM is read only in their browser, in a fixed worker. Only a conservative privacy-filtered projection reaches the interface and story templates. The application does not upload family files, stories or feedback, call external AI or archives, use browser storage or analytics, or retrieve source records.

Living, unknown, recently deceased, restricted and contradictory records are withheld. Only eligible people whose recorded death assertions have an upper bound before 1926 are shown. Notes, contacts, media, source prose, occupations and original identifiers are omitted. Names and places can still identify people, so automatic filtering does not guarantee anonymity.

Stories are deterministic readings of unverified GEDCOM assertions. Citation counts are pointers, not verified evidence. General context and researched context remain separate; the optional imagined scene is explicitly fictional. The built-in demo contains invented people and test assertions only. It is not a set of discovered archive records.

Tree, stories and feedback remain in the current session. Clear, consent withdrawal, replacement, page exit, inactivity of 30 minutes, or a two-hour total limit release the session. This is not forensic memory erasure. Feedback is saved only by a deliberate download; names are omitted by default, but user-written comments may identify family members. Original files, screenshots and downloaded feedback remain on the visitor's device.

GitHub Pages logs visitor IP addresses for security. Hosting metadata is separate from family content: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection

## Deployment contents

Publish `main` / `(root)` using GitHub Pages and enforce HTTPS. The repository root contains seven reviewed static application files, an empty `.nojekyll`, this README, ignore rules and the release hash manifest. It contains no real family data, GEDCOM downloads, screenshots, feedback, credentials, API keys, external libraries or server code. Relative asset URLs work under the repository's project path.

The deployed page uses a restrictive HTML content policy: outbound connections and form submissions are denied, scripts and styles are same-origin, and the parser is a fixed Blob worker. A stand-alone tab guard blocks file imports when embedded. GitHub Pages does not provide the local review server's custom no-store and frame-ancestors headers; no family data is in the static assets or cache. Source links open online only when deliberately clicked and include no family search query.

## Verification and baseline

Prepared 16 October 2026. The local completed preview passed 61 automated tests, source/bundle consistency checks, and prior fictional browser checks. The parser and fixed worker are byte-identical to the inspected Family Beta baseline `c68011bb1164f6740f93f846dcedbfdfe4346d69`. Only the hosted preview's notice was clarified to explain public website visibility and GitHub visit logging.

`RELEASE-SHA256.txt` identifies the exact website assets for deployment verification. After publication, repeat fictional import, story selection, context, investigations, feedback, clear, and no-upload checks against the live address.

The existing Genealogy Family Beta at https://alexanderjackson1982-boop.github.io/genealogy-family-beta/ is a different repository and remains unchanged. No synthetic investigation engine is connected. No external AI is configured; enabling one requires a separately approved provider, payload, consent flow and security design.

## Keep personal data out of this repository

Never commit or upload real GEDCOMs, parsed family data, feedback comments, private images, screenshots or credentials. Inspect the complete staged files and history before each public release; ignore patterns are only a secondary safeguard.
