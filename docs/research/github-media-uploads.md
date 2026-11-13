<!-- Research and live synthetic upload verification: GitHub media hosting without an evidence branch. No Factory behavior changes. -->
# GitHub media uploads without a Git branch

Researched 2026-11-13 from public documentation, GitHub CLI source and uploader source. Subsequently verified with synthetic PNG/MP4 uploads as recorded below. No browser-session access, credential extraction, installs or production access. Repository and issue operations used `gh-axi`; attachment upload used installed `gh` because the wrapper rejects `--attach`. Public documentation and source used HTTP GET. Except for the explicit live-test results, rendering statements below describe documentation or source evidence.

## Recommendation for Factory

**Prefer GitHub's first-party attachment flow for screenshots and short videos.** The premise that GitHub CLI cannot attach files is now outdated. GitHub CLI v2.99.0 shipped `--attach` on 2026-09-01 for issue/PR create, edit and comment commands. Official docs explicitly promise inline images and video players without committing media. It requires push access to the target repository. [1][2]

There is a verified local integration gap. Installed `gh-axi 0.1.35` rejects `issue comment --attach` with `VALIDATION_ERROR`; its source allowlists only `--body` and `--body-file` for comments and does not forward attachment arguments. Its `api --help` describes `--input` as a raw JSON body, not a binary upload facility. Installed `gh 2.102.1` successfully uploaded both fixtures with the existing CLI authentication. Factory adoption still needs wrapper support or an explicit direct-CLI integration choice, not browser-cookie extraction.

For an immediate upload without changing tooling, use the signed-in GitHub web editor manually. Browser automation can drive that same flow when explicitly authorized. For unattended workflows that cannot use the attachment endpoint's credentials, use release assets if permanent download links suffice, or Actions artifacts if expiring downloads suffice. Neither is an equivalent inline-video solution.

Factory's current `orchestrator/tracker.github.mts`, `uploadEvidence`, commits binaries to `sandcastle-evidence`. Its introductory statement that images cannot be uploaded through the API predates the new CLI flow. `orchestrator/handoff.mts` consumes returned Markdown before posting evidence. This note changes neither file; it records options for a later implementation.

## Options at a glance

| Route | Comment rendering | Access and lifetime | Main cost |
| --- | --- | --- | --- |
| First-party CLI attachment | Documented inline image/video | Public repo attachments publicly accessible; private/internal attachments repository-gated. No fixed expiry documented. [1][3] | Push access; wrapper support; token compatibility |
| Web editor, manually or automated | Native inline image/video | Same attachment rules | Signed-in browser, session/CSRF handling; automation can break |
| Replayed web upload protocol | Native attachment URL; images inline, videos as players according to uploader source. [6] | Same intended repository visibility; no documented API contract | Full-account session cookie; undocumented protocol |
| REST release asset | Supported download URL. Inline image/video behavior is not promised by the release API docs. [8] | Public releases public; private repo readers need access. No automatic expiry documented. [9] | Repository contents write; release/tag clutter |
| Actions artifact | Download link, not documented inline media | Signed-in repository readers; expires by policy or deletion. [11][12] | Retention, storage billing, workflow execution |
| External object/media hosting | Public images can render via Markdown/Camo; externally hosted videos are not supported as inline GitHub video players. [4] | Hosting ACLs and lifecycle, independent of repo visibility | Publication/privacy, cost, expiry and link maintenance |

## First-party CLI versus two different upload endpoints

### Supported CLI feature, token-based upload endpoint

Official docs say an attached image renders inline. For a video, a local Markdown image reference must be alone in its paragraph for the CLI to replace it with a bare uploaded URL and produce a player. A video reference within a sentence becomes a link. Unreferenced attachments are appended; repeated `--attach` flags attach multiple files. [1]

The implementation in CLI v2.104.0 posts raw bytes to:

```text
POST https://uploads.github.com/user-attachments/assets
  ?name=<basename>&content_type=<media-type>&repository_id=<numeric-id>
```

It sends authenticated API requests, `Content-Type: application/octet-stream`, a content length and JSON accept header, and reads a JSON `url`. This is not `/upload/policies/assets`, and it does not use a browser session or CSRF token. GitHub documents the CLI feature; the inspected REST reference does not establish this upload endpoint as a general, versioned REST attachment API. Prefer the supported command to copying its private protocol. [5]

Token caveats matter:

- CLI v2.99.0 explicitly allowed OAuth, classic PAT and fine-grained PAT token types. Repository permissions must be `WRITE`, `MAINTAIN` or `ADMIN`; read/triage is insufficient even if the user can comment. A PAT does **not** work by substituting it into the old browser-cookie flow. [5]
- Current v2.104.0 source no longer rejects token types locally. It says the server accepts tokens from **only some GitHub Apps**. It allows an absent GraphQL viewer permission for installation tokens and lets the endpoint decide. Do not promise arbitrary GitHub App or Actions `GITHUB_TOKEN` support. Older blanket claims that all App tokens are rejected are also stale. [5]
- I found no endpoint-specific official fine-grained permission matrix. Push access is the documented requirement, not proof that a token with only issue-write permission can upload. CLI login's classic-PAT baseline is `repo`, `read:org`, `gist`; that is login guidance, not a minimum upload-only scope specification. Use a dedicated, repository-limited credential where supported, and separately provision permission to create the target comment. [1][15]
- GitHub.com and Enterprise Cloud data-residency tenants are supported. GitHub Enterprise Server is explicitly rejected by the source. Current CLI flag source caps a batch at 50 attachments. [2][5]

### Undocumented browser upload protocol

`drogers0/gh-image` is an actual uploader, not just a suggested workaround. Its source implements both the token endpoint above and a browser-session fallback. The fallback performs these steps. [6]

1. GET the repository page with `user_session` and extract its embedded `uploadToken`.
2. POST multipart metadata to `https://github.com/upload/policies/assets`, including `repository_id`, name, size, content type and that token as `authenticity_token`.
3. Upload the bytes to S3 using the returned presigned form fields. The S3 request needs the policy, not a GitHub PAT.
4. PUT to the server-provided finalize path with its separate authenticity token. Paths include `/upload/assets/{id}` and `/upload/repository-files/{id}`.

Its cookie jar supplies both `user_session` and `__Host-user_session_same_site`. A normal form CSRF token is not interchangeable with the embedded `uploadToken`, nor with the finalize token. The source's flow documentation explains these distinctions. This is session authentication, not a supported PAT REST API. [6]

The uploader can extract cookies from browser stores and accepts a session override. Its own warning says these cookies grant full account access and are not scoped like PATs. Do not enable this as an invisible Factory fallback, copy a personal browser cookie into CI, or treat the extension's environment-variable support as a security boundary. Even a dedicated bot session remains sensitive and can expire. I inspected source only; I did not run the uploader or inspect any cookie store. [6]

The old CLI request described the browser-only limitation in 2020. It now points to the newer, completed attachment feature request. Treat that history as context, not evidence that no token-based route exists today. [7]

### Browser automation

The official web workflow is drag/drop, paste, or file selection in the comment editor; GitHub uploads immediately and inserts the attachment URL before the comment is submitted. Browser automation can operate that UI using an authorized signed-in profile, then wait for the final Markdown URL before submitting. This preserves the native rendering path without committing media. The newer CLI feature request also records a reporter using Playwright to drive the web upload handler. That is a reported workaround, not a stable automation API or something tested here. [3][7]

Keep browser credentials outside the implementation/verifier container. Restrict navigation and the target repository, use a dedicated profile where practical, prevent duplicate comment submission on retries, and do not log cookies, upload policies or signed storage URLs. These are recommendations, not GitHub guarantees. The browser route can serve commenters without push access, but introduces login/2FA/SSO interruptions and UI-change risk.

## Native attachment limits, privacy and deletion

GitHub documents 10 MB for images/GIFs; video is 10 MB for repositories on free plans and 100 MB on paid plans. Uploading videos above 10 MB also requires organization membership, outside-collaborator status, or a paid uploader plan. Other supported attachments are limited to 25 MB. PNG, GIF, JPEG, SVG, MP4, MOV and WebM are supported media; GitHub recommends H.264 for browser compatibility. The CLI supports images/media, not the entire web attachment file list. [1][3]

The current attachment docs say public-repository uploads need no authentication; private/internal uploads require repository access. However, the anonymized-URL docs also warn that anyone receiving an anonymized delivery URL may view the media. Keep canonical `github.com/user-attachments/...` URLs in comments, not captured CDN redirects or signed delivery URLs. Do not describe repo-gated canonical URLs as DRM or a guarantee against forwarding. The uploader additionally reports that unreferenced uploads initially resolve only for their uploader; that is source-author evidence, not an official lifetime/access contract. [3][4][6]

No fixed attachment-retention period is stated in these docs. This does not establish perpetual availability. Removing a comment or its link does **not** necessarily delete the binary, including media uploaded but removed before saving a description. GitHub directs removal requests to Support. The CLI source likewise warns that uploads cannot be undone and that partially successful batches must still have their successful URLs written to a resource. This makes redaction before uploading essential. [4][5]

## Documented REST release assets

Release assets live outside Git blobs. Create or reuse a release on a tag pointing at existing code, then send raw bytes with the appropriate media type to the release's returned `upload_url`. The API returns `browser_download_url`. The download endpoint can stream bytes or redirect, so clients must handle both. Duplicate asset names fail unless the prior asset is deleted; use unique run/tip names. [8]

Creating/managing a release requires push access and normally fine-grained `Contents: write`; reading a private asset requires repository access and `Contents: read`. GitHub App tokens are documented for release creation and asset reads/management. Creating a tag on a commit that changes workflow files can additionally require workflow-write authorization; avoid creating an evidence tag on an arbitrary unmerged workflow change. Separate comment-posting permission is still needed. [8][10]

Published public releases expose their assets publicly. Private releases require repository read access. A draft is not a general-purpose reviewer media CDN; do not assume its assets are readable to every commenter. Each release permits up to 1,000 assets, each **under 2 GiB**, with no documented total release-size or bandwidth cap. There is no documented automatic expiry, but deletion and release policies still matter. [9][10]

Use `[Download recording](<browser_download_url>)` as the reliable contract. A public release image URL might be usable in an image reference if response headers and redirects cooperate, but the release documentation does not promise inline comment rendering. Private download URLs cannot generally be fetched by Camo with a reviewer's credentials, and these are not native user-attachment video URLs. I did not test either rendering case. Never put a PAT in a comment URL to make a private download public. [4][8]

This is the best documented API fallback for long-lived downloads, not a reason to promise inline screenshot/video parity. A dedicated evidence release also needs cleanup and naming policy so automated evidence does not masquerade as product releases.

## Actions artifacts

`actions/upload-artifact` keeps binaries out of Git and returns an `artifact-url` suitable for issue/PR **links**. The action explicitly requires users to be logged in to follow that URL. GitHub's download guide requires repository read access, even for the normal public-repository UI download flow. The current action can upload zipped artifacts or a single unzipped file; neither is documented as an inline GitHub comment image/video host. [11][12]

Default retention is 90 days. Policy allows 1–90 days for public repositories and 1–400 for private repositories, bounded by organization/enterprise settings. URLs fail after expiry or deletion of the artifact, run or repository. The REST archive-download redirect expires after **one minute**, so copying that storage URL into a comment is not a durable workaround. Fine-grained download tokens need `Actions: read`; deletion needs `Actions: write`. Some metadata endpoints allow anonymous public reads; this does not make the signed-in UI artifact link an anonymous inline media URL. [12][13]

The upload action uses workflow runtime credentials, not a general PAT upload endpoint for arbitrary local Factory files. It limits a job to 500 artifacts. Storage is metered under Actions billing; avoid uploading the whole workspace or hidden credential files. Hidden files are excluded by default in the inspected action. Grant separate comment-write permission only to trusted publishing jobs; do not hand secrets to untrusted PR code. [11][16]

## External hosting

A public HTTPS image with a Camo-supported image `Content-Type` can be embedded with Markdown. A private object requiring cookies/authorization cannot generally be fetched by Camo. GitHub explicitly says externally hosted videos are not supported by its inline video mechanism; use a linked thumbnail or ordinary link to an external player instead. A direct `.mp4` URL or an arbitrary HTML `<video>` tag is not a documented substitute. [4]

Object hosting gives explicit lifecycle and deletion control but does not inherit GitHub repository permissions. For S3, presigned URLs are bearer credentials and expire at the configured time or earlier when the signing credentials expire. IAM-user SigV4 URLs last at most seven days; temporary-role credentials can shorten that. Avoid putting presigned evidence URLs into long-lived comments, and never call them private to repository members. A public bucket/object can support stable images, but deliberately publishes the content. Limits, storage/egress charges and retention are provider-specific. [14]

Use a private external player/download page when privacy matters more than inline rendering. Keep publishing credentials on the host, redact screenshots and recordings, remove sensitive metadata, and allowlist destination hosts. None of these routes makes an accidental secret upload safe.

## Live verification, 2026-11-13

On the user's request, created private repository `markdlabrecque/factory-media-upload-test-20261113` and [a synthetic attachment test comment](https://github.com/markdlabrecque/factory-media-upload-test-20261113/issues/1#issuecomment-6863601091). Retained the repository and comment for inspection. It contains no project data.

- `gh-axi 0.1.35 issue comment --attach` failed locally with `unknown flag` / `VALIDATION_ERROR`, before creating a comment. Source inspection confirmed that attachments are not forwarded.
- Generated a 640×360 PNG test pattern, 26,458 bytes, and a two-second H.264/yuv420p MP4, 180,982 bytes, with FFmpeg.
- Installed `gh 2.102.1 issue comment` with two `--attach` flags uploaded both files using the existing CLI authentication. No token was extracted or printed, and its credential type was not established.
- Read the saved comment through `gh-axi`. Its Markdown contains a native `github.com/user-attachments/assets/...` image reference and a standalone native video URL.
- Requested GitHub's rendered comment HTML. It contains an `<img>` and a `<video controls>` player. Retrieved both rendered media resources and verified SHA-256 equality with the original fixtures and the correct `image/png` and `video/mp4` content types. Signed delivery URLs were not saved in this report.
- Anonymous requests to both canonical attachment URLs returned HTTP 404 while authenticated comment rendering provided usable media URLs.
- The repository's branches API returned `[]`. The upload created no branch or commit.

This verifies upload, server-side rendering, authenticated media retrieval and byte integrity. It does not establish browser playback, another user's access, public-repository behavior, alternate credential types, maximum sizes, retries or partial failures. Factory's actual unattended credential was not tested separately.

## What to verify before implementation

Verify wrapper support after implementing it, Factory's intended OAuth/PAT/App credential, comment-write versus upload permissions, public anonymous and private second-user viewing, browser playback, limits, retry/partial-upload behavior and cleanup. Do not increase token privileges or switch to browser cookies automatically after a 404.

## Sources

1. [GitHub docs: attaching files with GitHub CLI](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli).
2. [GitHub CLI v2.99.0 release](https://github.com/cli/cli/releases/tag/v2.99.0), first-party attachment announcement and command list.
3. [GitHub docs: attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files), visibility, browser flow, formats and limits.
4. [GitHub docs: anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls), Camo, external videos, access warning and attachment deletion.
5. GitHub CLI source: [v2.104.0 upload client](https://github.com/cli/cli/blob/v2.104.0/internal/attachments/client.go), [host mapping](https://github.com/cli/cli/blob/v2.104.0/internal/ghinstance/host.go), [v2.99.0 token allowlist](https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client.go), [current flag limits](https://github.com/cli/cli/blob/v2.104.0/internal/attachments/flags.go), [partial-upload/lifetime contract](https://github.com/cli/cli/blob/v2.104.0/internal/attachments/doc.go), [credential-check change](https://github.com/cli/cli/commit/17ac598e6afc43bb6206f074b05de9d63563a42f).
6. `drogers0/gh-image` source, inspected at main tree `ca57d96dd4ac72bae5c8264a244116bd17f96ce8`: [upload orchestration, policy and finalization](https://github.com/drogers0/gh-image/blob/ca57d96dd4ac72bae5c8264a244116bd17f96ce8/internal/upload/upload.go), [token endpoint](https://github.com/drogers0/gh-image/blob/ca57d96dd4ac72bae5c8264a244116bd17f96ce8/internal/upload/bearer.go), [reverse-engineered protocol](https://github.com/drogers0/gh-image/blob/ca57d96dd4ac72bae5c8264a244116bd17f96ce8/documentation/github-image-upload-flow.md), [README security warnings and rendering claims](https://github.com/drogers0/gh-image/blob/ca57d96dd4ac72bae5c8264a244116bd17f96ce8/README.md). The README's blanket Actions-token warning is not a current official support matrix.
7. CLI history: [original attachment request](https://github.com/cli/cli/issues/1895), [newer completed request and discussion](https://github.com/cli/cli/issues/13256). Historical reports are not present-day API guarantees.
8. [GitHub REST release assets](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28), upload/download protocol, permissions and duplicate names.
9. [GitHub docs: about releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), reader/writer access and asset quotas.
10. [GitHub REST releases](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#create-a-release), create permissions, tags and workflow authorization.
11. [Official actions/upload-artifact source README](https://github.com/actions/upload-artifact#readme), inputs, outputs, unzipped option, runtime upload workflow and limits.
12. [GitHub docs: downloading workflow artifacts](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/downloading-workflow-artifacts).
13. [Artifact retention policy](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization) and [REST artifacts](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28), expiry and token permissions.
14. [AWS S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), bearer access and credential-dependent expiry.
15. [GitHub CLI login manual](https://cli.github.com/manual/gh_auth_login), classic-PAT baseline and fine-grained token caveat.
16. [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions), artifact storage metering.
