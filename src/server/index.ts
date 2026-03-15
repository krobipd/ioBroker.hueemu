/**
 * Server module exports
 */

export { HueServer, type HueServerOptions } from "./hue-server";
export { apiV1Routes, type ApiRoutesOptions } from "./routes/api-v1-routes";
export {
  descriptionRoute,
  type DescriptionRouteOptions,
} from "./routes/description-route";
export {
  hueErrorHandler,
  createErrorResponse,
  createSuccessResponse,
  wrapHandler,
} from "./middleware/error-handler";
