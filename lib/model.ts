// Stable public imports for routes and editors. Domain modules use their focused
// dependencies directly so schemas, persistence and rendering do not form cycles.
export * from './profile-types.ts';
export { AppError } from './app-error.ts';
export { normalizeHandle, normalizeDestination } from './profile-validation.ts';
export {
  actionSchema,
  pictureActionSchema,
  spaceSelectorSchema,
  type Action,
} from './profile-action-schema.ts';
export { applyAction } from './profile-actions.ts';
export { platforms, type Platform } from './link-options.ts';
export { findVisibleLink } from './profile-links.ts';
