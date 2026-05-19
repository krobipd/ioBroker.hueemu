/**
 * UPnP Description XML route
 */

import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { generateDescriptionXml, type DescriptionXmlOptions } from "../../discovery";

/**
 * Options for the description route plugin
 */
export interface DescriptionRouteOptions extends FastifyPluginOptions {
  /** Options for generating the description XML */
  descriptionOptions: DescriptionXmlOptions;
}

/**
 * Fastify plugin that registers the /description.xml route
 *
 * @param fastify - Fastify instance to register the route on
 * @param options - Plugin options with description XML config
 */
export function descriptionRoute(fastify: FastifyInstance, options: DescriptionRouteOptions): void {
  const { descriptionOptions } = options;

  // Generate the XML once (it's static)
  const descriptionXml = generateDescriptionXml(descriptionOptions);

  fastify.get("/description.xml", (_request, reply) => {
    reply.type("application/xml").header("Content-Length", Buffer.byteLength(descriptionXml)).send(descriptionXml);
  });
}
