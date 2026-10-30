# Deployment permission

- Always ask the user for explicit permission before each deployment. Prior deployment approval does not authorize a later deployment.
- Finish implementation and appropriate local checks first, then describe the concrete changes and target environment for approval.
- Treat pushing to `main`, merging a PR, rerunning a deployment job, or triggering GitHub Actions as deployment actions when they publish automatically. Obtain permission before triggering them.
- Production migrations and infrastructure changes that are part of a release belong in the approval request. Planning requests authorize documentation only.

# Apostrophes

- Never use U+2019 (curly apostrophe) in authored code, UI copy, documentation, or responses. Use the ASCII straight apostrophe (U+0027) instead. Escape it as needed for the source language; JSX text may use `&apos;`.

# Visual alignment

- Use shared spacing values for related UI surfaces. Verify the rendered edges of headers, controls, icons, rows, and footers on desktop and mobile; matching container padding alone is not sufficient.
- Dashboard screens use the shared gutter in `app/dashboard/dashboard.css`; public files use `app/styles/profile-column.css`. Do not introduce a second window/desktop shell or app-specific copies of navigation and spacing.

# Dividers

- Inset, floating, and partial-length structural dividers are prohibited throughout the project, including toolbars and menus. This applies to horizontal and vertical dividers.
- Every divider must reach both edges of its containing surface (page, pane, toolbar, or menu) and use the shared solid ink border (`var(--border)`). Keep content inside its normal gutter.
- Separate small groups of controls with spacing when a full-span divider would be inappropriate. Never add a short vertical rule between toolbar buttons.
- Verify the rendered endpoints on desktop and mobile, including when controls wrap. Use `panel-section-divider` for boundaries inside padded content.

# Dashboard and profile content

- The page or dialog is the outer surface. Never wrap its only content panel in another bordered or shadowed card.
- Use the shared page layout and content gutter by default. Stacked form/settings groups (photo, Bio, account details, address, contact details) are flat sections separated by dividers, not individual cards. Use `panel-section` for these groups and `panel-section-divider` at their boundaries.
- Keep cards for actual items or choices, such as plan options, theme choices, file previews, and resource links. A section heading alone does not justify a card.
- Section boundaries follow the project-wide divider rule above; do not introduce thin, muted, inset section rules.
- Apply this rule across sibling screens when changing page layouts, rather than fixing only the app shown in a screenshot. Check desktop and mobile alignment.
