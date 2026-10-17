# Wya product ideas and next steps

Wya spaces can grow into personal portfolios: a place to show who you are, where to find you, and what you have made. Keep simple link pages easy to use while letting people add more context to their work. Editing through ChatGPT should remain a core part of the experience.

This is a living planning document. Only profile pictures below are complete; future features, limits, layouts, and data structures are proposals until agreed. No implementation is authorized by this roadmap.

## Current direction

| Step | Capability | Status |
| --- | --- | --- |
| 1 | Profile pictures for personality | Implemented and deployed |
| 2 | Custom colors and a cover image | Planning |
| 3 | Alternative page designs alongside neobrutalism | Planning |
| 4 | Projects and portfolios within a space | Exploring the product model |

Profile pictures are per space, accept JPEG/PNG/WebP up to 5 MB, and support browser cropping, rotation, and optimization. R2 stores the current image. Replacing or removing it does not keep photo history. Local upload/storage integration and deployment checks passed; the live controls were verified. Automated browser file-upload testing was limited by Chrome's file-access permission.

Existing spaces also have links, icons, a bio, and three color themes. Custom colors, covers, multiple layout families, and projects are additions to those capabilities.

## Product principle

A link tells a visitor where to go. A project explains what they will find and why it matters. A space brings both together under the same identity and address.

Keep three concepts separate:

- **Content:** profile, links, and projects owned by a space.
- **Appearance:** colors, cover, and page design.
- **Presentation:** section order, featured projects, and card arrangement.

Changing appearance must preserve content and URLs. People who only want links should not need to configure portfolio features.

## Step 2 Colors and covers

Start with curated palettes plus a custom accent color. Derive readable text and surface colors, and show a live preview. If an accent makes text unreadable, offer a suitable text color or restrict that particular combination. Broader control over background and text can follow once the preview and contrast behavior are clear.

A cover image is an optional banner behind or above the profile header. It is separate from the avatar. Let people upload, reposition a focal point, preview desktop/mobile crops, replace, and remove it. Keep names and bios readable on a solid surface or a reliable overlay.

Proposed first version: header covers, with full-page backgrounds left for later. Full-page images introduce more readability and responsive-cropping choices than a banner.

Reuse the browser optimization and private R2 storage approach. Cover dimensions and file limits need their own decision; the avatar's 512px output is too small for a wide banner. Keep only the current cover as a proposed default. The confirmed no-history rule currently applies to avatars.

Done when colors and covers work per space, remain readable on small screens, and removing a cover restores a good default header.

## Step 3 Page designs

Offer a small set of designed layouts, with the same content available in each:

| Proposed design | Visual direction | Good fit |
| --- | --- | --- |
| Bold | Existing neobrutalism, strong borders and offset shadows | Playful personal pages and makers |
| Editorial | Typography-led sections, generous spacing, restrained borders | Writing, consulting, and detailed work summaries |
| Gallery | Image-led project grid with a compact profile header | Designers, photographers, and visual portfolios |

These names and choices are suggestions, not final selections. Build one alternative first to validate that the content model works across designs.

Select the page design separately from its palette. Preview a change using the person's actual content before saving. Provide deliberate empty states: Gallery still needs to look intentional with only links or with projects that have no images.

Define the project-card content before building multiple designs, even if projects ship afterward. Each design should account for projects, long titles, missing images, keyboard navigation, and mobile layouts.

Arbitrary HTML/CSS, generated custom layouts, and HTML export remain later ideas. Start with supported templates so dashboard and ChatGPT edits behave predictably.

## Step 4 Projects inside a space

### First portfolio experience

Add an optional **Selected work** section to the existing public space. Start with a header, selected projects, and regular links; allow a simple choice of whether work or links comes first. Hide empty sections automatically.

For example, Alex's space could show a Wya project card with a screenshot, “A home for your links, managed through conversation,” a role such as “Creator,” and separate Visit and Source links. A photographer could show a photo series linking to a gallery; a writer could showcase an essay; a musician could showcase a release. Projects should not assume GitHub or software development.

The initial card can contain:

| Field | Proposed behavior |
| --- | --- |
| Title | Required; describes the work rather than its hosting platform |
| Summary | Required short explanation, with a proposed 280-character limit |
| Image | Optional single thumbnail; attractive text-only fallback |
| Destinations | One or more labeled links, with a proposed maximum of three and one primary action |
| Role | Optional, such as designer, developer, author, or collaborator |
| Tags | Optional small set for tools, medium, or topic; visitor filtering can wait |
| Visibility | Explicit draft or published state |
| Placement | Manual order and a featured flag |

Suggested initial cap: 12 projects per space, with up to six featured. Confirm these numbers before implementation; they are starting points for a manageable page, not current product limits.

### Creating a project from a link

Offer two entry points: **Add project** and **Create project from this link**.

1. Start from an existing space link, paste a destination, or enter the details manually.
2. Prefill the known title and destination. Ask the person to describe what they made and their contribution.
3. Add an optional thumbnail and secondary links.
4. Preview the card in the current page design.
5. Explicitly publish it, or leave it as a draft.

Creating a project from an existing link should initially leave that link and its short URL intact. Make any removal from the links section a separate explicit choice. A project's copied destination should be independent in the first version, so editing it does not silently change an existing redirect.

Manual creation is sufficient for the first release. Later, “Import from URL” could suggest a title, description, and image from public metadata or a supported GitHub repository. Treat these as editable draft suggestions. A URL does not prove authorship, and a preview image is not automatically licensed for reuse. Ask people to confirm their role and image choice. Imported page instructions must never authorize account changes or publishing.

### Public URLs

For the first release, show project cards directly on `wya.im/alex`; their buttons open the chosen destinations. A stable fragment such as `wya.im/alex#project-<id>` can link to a particular card without a new page type.

Standalone case-study pages can come later, for example `wya.im/alex/projects/my-project`. Check the existing `/:handle/:slug` redirect namespace before selecting routes. In particular, do not silently replace an existing `/alex/projects` short link with a project index. Stable internal project IDs should survive title and username changes.

### Editing with ChatGPT

Support the same actions as the dashboard through shared validation and ownership checks. Example requests:

- “Create a draft project from my Wya link and describe it as a link directory I built.”
- “Add a Source button to that project using this repository URL.”
- “Feature my photography series above my other projects.”
- “Move Selected work above my social links.”
- “Preview an editorial layout with a blue accent.”

A later preview workflow should let the user review appearance or imported content before publishing. New file uploads can continue through the dashboard until there is an explicit, supported attachment-transfer flow. Distinguish saving a draft from publishing it in tool names and results.

## Suggested system shape

Keep the existing Cloudflare Worker, D1, R2, authenticated dashboard, and OAuth-protected MCP endpoint. No new service is proposed for the initial portfolio release.

- **D1:** space appearance settings and structured projects with stable IDs, ownership through `space_id`, visibility, ordering, and version checks. A dedicated projects table is a reasonable starting point; decide its relationship to existing space revisions before implementation.
- **R2:** avatar, cover, and project-thumbnail objects. Reuse the upload lifecycle and cleanup pattern, but extend reference tracking to every image owner. The current avatar cleanup query only understands space pictures and must not be reused unchanged for new media.
- **Browser:** crop, optimize, and preview images before upload. Backend authentication, ownership, byte limits, and file-type checks still apply; no backend image transformation is proposed.
- **Rendering:** shared content passed to a small template registry. Presentation choices should not require duplicate project data per design.
- **Dashboard and MCP:** shared create/update/reorder/publish operations with conflict detection. Public rendering excludes drafts and private editing metadata.

Decide project text revision behavior separately from image retention. Restoring old content must not resurrect references to image objects that were deleted. Avoid extending full-profile restore to projects accidentally.

If URL imports are added later, server-side fetching needs bounded time/size, redirect validation, and protection against requests to private network addresses. Importing is optional enrichment and must not prevent manual project creation.

## Planning sequence

1. Agree on color controls and whether the first image option is a header cover. Sketch the editor and desktop/mobile profile header.
2. Agree on the project-card fields using three examples: a software project, a visual project, and a piece of writing.
3. Sketch those same examples in Bold and one alternative design. Validate that changing design preserves all important content.
4. Scope the first release of colors/covers, then alternative design, then manual projects. Each scope gets its own implementation request and checks.
5. Try the portfolio flow with a few real examples before deciding on imports, galleries, visitor filters, or case-study pages.

## Decisions still open

- Accent-only customization first, or background/text controls too?
- Header cover first, or is a full-page background essential?
- Which alternative design should follow Bold: Editorial or Gallery?
- Are the proposed 12-project cap, six featured projects, and three destinations useful starting limits?
- Should the first portfolio version have draft/publish controls for projects only, or preview/publish for the whole space?
- Should project text have revisions? How should restoring text interact with current images?

## Later possibilities

Case studies with multiple images; reusable link/project groups; contact and availability sections; richer GitHub imports; project galleries; HTML export; and AI-assisted layout selection. Revisit these after the simple portfolio flow is useful. Automatic social-feed syncing, arbitrary embeds, and a general page builder are outside the proposed first version.

## Deployment rule

Always ask the owner for permission before each deployment. Finish the agreed work and local checks first, then present the exact changes, target, and any migrations or infrastructure changes for approval. Pushing or merging to `main` currently triggers deployment, so it also requires prior approval. Planning work does not authorize implementation or deployment. This rule is also recorded in the repository's `AGENTS.md`.
