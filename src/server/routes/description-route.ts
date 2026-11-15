/**
 * UPnP Description XML route
 */

import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { generateDescriptionXml, type DescriptionXmlOptions } from "../../discovery";

/**
 * Options for the description route plugin
 */
export interface DescriptionRouteOptions extends FastifyPluginOptions {
  /** Options for generating the description XML — the host comes per request */
  descriptionOptions: Omit<DescriptionXmlOptions, "host">;
  /**
   * This host's address for a client (D17, `ownAddressFor` of the fleet master): the address
   * the description names to the client that asks — undefined when no own network holds it.
   */
  addressFor: (peer: string | undefined) => string | undefined;
}

/**
 * Fastify plugin that registers the /description.xml route. The description names the host
 * the asking client reaches this bridge under (fleet rule krobi 2026-11-11 19:34: the adapter
 * never picks an address by itself), so it is built per request.
 *
 * @param fastify - Fastify instance to register the route on
 * @param options - Plugin options with description XML config
 */
export function descriptionRoute(fastify: FastifyInstance, options: DescriptionRouteOptions): void {
  const { descriptionOptions, addressFor } = options;

  fastify.get("/description.xml", (request, reply) => {
    const host = addressFor(request.ip);
    if (host === undefined) {
      // No own network holds the client — the trust boundary in front answers such a client
      // with a bare 403 already; this keeps the route from naming an address it has not got.
      reply.code(403).send();
      return;
    }
    const descriptionXml = generateDescriptionXml({ ...descriptionOptions, host });
    reply.type("application/xml").header("Content-Length", Buffer.byteLength(descriptionXml)).send(descriptionXml);
  });
}
