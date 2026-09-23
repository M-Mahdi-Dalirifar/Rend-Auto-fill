# Rend Autofill architecture

Rend Autofill is split into four layers: core orchestration, ATS adapters, answer and resume resolution, and popup UI. Browser-page DOM details belong in adapters; the core works with normalized fields and results.

## Request flow

1. The popup reads saved data through `src/core/storage.js`.
2. `src/adapters/registry.js` chooses an adapter from URL and page signals.
3. The selected adapter scans the page and produces normalized fields and job context.
4. The answer resolver chooses an explicit stored answer source.
5. The autofill engine asks the adapter to fill and verify the platform-specific control.
6. Diagnostics are returned in a platform-neutral format for display and logging.

## Adding an ATS

Create `src/adapters/<platform>/adapter.js`, extend `BaseAdapter`, implement page detection and the adapter contract, keep selectors and widget behavior in that platform folder, and register the adapter before `GenericAdapter` in `popup.js`. The generic adapter must remain last because it is the conservative fallback.

The common contract includes `isSupportedPage`, `getPlatformName`, `scanFields`, `getJobContext`, `fillTextField`, `fillSingleSelect`, `fillMultiSelect`, `uploadFile`, `verifyField`, and `supportsField`.

## Greenhouse compatibility

The Greenhouse adapter owns platform detection, job-context extraction, diagnostic-world setup, and execution of the established Greenhouse page runtime. Its smaller scanner, mapper, dropdown, multi-select, self-identification, and resume modules are extraction seams for subsequent low-risk decomposition. This compatibility boundary preserves the tested interaction sequence while keeping Greenhouse decisions out of the core.

## Ashby adapter

The Ashby adapter detects hosted and embedded forms, scans semantic Ashby field containers into normalized fields, resolves answers through the shared `AnswerResolver`, and delegates DOM interaction to its isolated page runtime. It supports native inputs/selects, Ashby's observed Yes/No buttons, searchable portal listboxes, file inputs, radio/checkbox groups, and conservative multi-select handling. Unknown fields retain their full question text and return `UNRESOLVED`; the adapter installs a capture-phase submit guard during all interactions.

## Resume persistence

Resume metadata and PDF bytes live together in the IndexedDB `resumes` store. Records include `id`, `filename`, `displayName`, `jobTitles`, `keywords`, `skills`, `isDefault`, `createdAt`, `updatedAt`, MIME type, last-modified time, and binary data. On first use, the prior `resume/current` record is copied to `legacy-current`; the old record is deliberately retained.

## AI boundary

The AI modules are inactive interfaces only. No network call is made. The answer resolver never passes self-identification fields to an AI resolver; those fields resolve only from the explicit Self-Identification Profile.

## Popup UI

For each production revision handed to a Chrome tester, bump `manifest.json` version and the build ID in `src/ui/buildIdentity.js`. Reload the unpacked extension at `chrome://extensions`, then verify the popup's version/build label and the matching values in Copy Debug Report.

The popup is a two-view mini application. Dashboard presents active job context, automatic or manually overridden resume selection, scan/autofill actions, status counts, and quick links. Settings uses one-at-a-time panels for Profile, Preferences, Self-Identification, Resumes, and Diagnostics. `src/ui/popup.js` owns navigation, `src/ui/render.js` owns reusable DOM rendering, and the root popup script continues to coordinate the existing business operations.

Visual tokens such as colors, spacing, radii, shadows, and control height are centralized as CSS custom properties in `popup.css`. Future branding or theme work should change these tokens rather than autofill code.
