# Deployment permission

- Always ask the user for explicit permission before each deployment. Prior deployment approval does not authorize a later deployment.
- Finish implementation and appropriate local checks first, then describe the concrete changes and target environment for approval.
- Treat pushing to `main`, merging a PR, rerunning a deployment job, or triggering GitHub Actions as deployment actions when they publish automatically. Obtain permission before triggering them.
- Production migrations and infrastructure changes that are part of a release belong in the approval request. Planning requests authorize documentation only.
