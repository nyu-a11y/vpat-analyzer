# Stage 0 synthetic HtmlService harness

This isolated harness is the decisive ingestion feasibility proof. It is not the production application and accepts no arbitrary Drive ID from the browser. Its build contains only committed synthetic fixture bytes. The committed source and proof summary contain no deployment URL, Drive file ID, credential, user document content, or provider route.

## Read-only/local preflight

From the repository root, run:

```sh
npm run fixtures:stage0
npm run test:contracts
npm run test:ingestion
npm run build:harness:stage0
node scripts/run-stage0-live-proof.mjs --local
```

The ignored `build/stage0/` directory contains the inline local page, deployable Apps Script source, packaged synthetic fixture provisioner, and `build-manifest.json`. The build identity binds the inline ingestion and guard bundles, committed fixture manifest, canonical positive projections, Apps Script sources, and local/live templates. The local Playwright run checks the same fixture hashes and projection digests, but it does not clear the Drive, DocumentApp, `google.script.run`, or HtmlService portions of the live gate.

Do not read or use `.env.local`. Do not copy any deployment or Drive binding into source, terminal output, proof output, or version control.

## Authorized two-account provisioning

Everything in this section mutates Google state and requires the owner's separate approval. Use only NYU test accounts and the generated `build/stage0/` project. Never substitute a production VPAT.

1. Choose two NYU test accounts. Account B owns and deploys the generated Apps Script project. Account A is the proof viewer and temporarily receives editor access only for provisioning its own accessible fixtures. This role split makes execution identity observable: owner-mode runs as B and cannot read A's normal fixtures, while `USER_ACCESSING` runs as A and can.
2. As Account B, select and run `provisionStage0InaccessibleSentinelAsSecondaryAccount_()` in the Apps Script editor. The function deterministically creates or re-verifies a real private synthetic sentinel owned by B, stores its ID only in Script Properties, and records a SHA-256/byte-count/build attestation valid for 24 hours. It returns no ID. Re-run it after every rebuild and complete the Account A live proof within that 24-hour window. Do not share this sentinel with Account A.
3. Temporarily share only the Apps Script project—not B's sentinel—with Account A as an editor. As Account A, select and run `provisionStage0SyntheticBinaryFixtures_()` once in the editor. A repeat run verifies existing files and never replaces a binding.
4. Still as Account A, select and run `provisionStage0SyntheticGoogleDoc_()` once. A repeat run verifies the existing private primary Google Doc against the build-bound canonical candidate-document digest.
5. Still as Account A, select and run `provisionStage0SyntheticGoogleDocOverflow_()` once. It creates and verifies a separate Google Doc with one normalized 10,001-character paragraph, exactly one character above the serializer limit; the web proof must receive a schema-valid `RESOURCE_LIMIT_EXCEEDED` result without slicing it.
6. Confirm every generated Script Property from `HarnessBinding.gs` is present. Normal fixtures, `STAGE0_GOOGLE_DOC_ID`, and `STAGE0_GOOGLE_DOC_OVERFLOW_ID` must be accessible to A and inaccessible to B; only `STAGE0_INACCESSIBLE_FILE_ID` must be inaccessible to A and accessible to B. Do not share these files between accounts, and do not copy any property value into a local file or command.
7. Remove Account A's temporary editor access to the Apps Script project without changing any file or Script Property. Account A must still be unable to open B's sentinel, and B must still be unable to open A's normal fixtures/docs.
8. As Account B, deploy the generated project as a web app that executes as the user accessing it, restricted to the authorized NYU test audience. Open it as Account A. A deployment that executes as the owner runs as B, loses the normal fixture matrix, and cannot pass this proof.

If any existing binding is shared, stale, wrong-MIME, wrong-byte-length, or wrong-digest, stop and resolve it explicitly. The provisioners intentionally do not overwrite it. The harness rechecks that every A-readable fixture remains private, re-hashes each whole binary file, validates every 16 KiB chunk, and refuses a binding that differs from the committed manifest.

## Authorized live run

Use a browser profile already signed in as Account A. Keep the URL and ignored output local:

```sh
node scripts/run-stage0-live-proof.mjs \
  --url "<deployed-harness-url>" \
  --profile "<local-browser-profile-directory>" \
  --headed
```

The runner starts browser-context request accounting before navigation, blocks and counts unexpected origins and Worker/service-worker activity, invokes the single synthetic flow by keyboard, verifies the harness landmark, heading, live-region, labeled-table, focus-indicator, and 44 px target contract, binds the result to the current build manifest, validates the JSON summary against `schemas/stage0-proof-result.v1.schema.json`, and writes only scrubbed case keys, counts, durations, and SHA-256 digests. Its privacy flags are derived from a scan of the canonical summary rather than hard-coded assertions. A live pass requires a CSP response header on the exact document frame containing the proof control; the app-authored meta policy alone is sufficient only for the local adjunct.

A pass requires the user-accessing identity probe (all A-owned normal files/docs accessible and B's sentinel inaccessible), all fixture cases, the actual primary and deterministic-overflow DocumentApp cases, the inaccessible-source case, exact positive projections, exact rejection codes, JSON-only RPC round trips, at least two real multi-chunk Drive transfers including the primary DOCX, at least one transfer spanning multiple 16-chunk RPC batches, observed duration limits, sampled Chrome heap limits, zero CSP violations, and zero unexpected network/Worker activity.

The generated manifest uses the full Drive scope because Apps Script's built-in `DriveApp.createFile()` and `DriveApp.getFileById()` APIs document `drive` / `drive.readonly`, not `drive.file`, as their accepted scopes. The proof web app exposes no arbitrary ID input and reads only build-bound Script Property keys. Do not reuse this isolated proof manifest as the production manifest without a separate least-privilege review.

All four manual provisioning entry points end in `_`. Apps Script treats those functions as private to `google.script.run`, so the deployed browser client cannot invoke Drive- or Document-mutating provisioning operations. They remain selectable for the explicitly authorized editor runs above.

The duration evidence is explicitly observed and non-preemptive; it does not prove that Apps Script can interrupt a synchronous parser at a deadline. `performance.memory` is sampled and is not an exact peak measurement. A local result, missing live memory support, a missing/stale build-bound secondary-account sentinel attestation, or a deployment running as the owner cannot clear the live gate.

The small accessibility matrix applies only to this isolated proof control. It does not replace Stage 1 product evidence for axe, reflow/zoom, forced colors, reduced motion, focus restoration, reading order, screen-reader operation, or the approved five-tab export workflow.

After review, clean up temporary Google files and Script Properties manually under the same explicit authorization. Generated browser evidence, URLs, profiles, file IDs, and deployment IDs remain ignored and must never be committed.
