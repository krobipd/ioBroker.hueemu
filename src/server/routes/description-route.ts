/**
 * UPnP Description XML route
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { generateDescriptionXml, type DescriptionXmlOptions } from '../../discovery';

/**
 * Options for the description route plugin
 */
export interface DescriptionRouteOptions extends FastifyPluginOptions {
    /** Options for generating the description XML */
    descriptionOptions: DescriptionXmlOptions;
}

/**
 * Fastify plugin that registers the /description.xml route
 */
export async function descriptionRoute(
    fastify: FastifyInstance,
    options: DescriptionRouteOptions
): Promise<void> {
    const { descriptionOptions } = options;

    // Generate the XML once (it's static)
    const descriptionXml = generateDescriptionXml(descriptionOptions);

    fastify.get('/description.xml', async (request, reply) => {
        reply
            .type('application/xml')
            .header('Content-Length', Buffer.byteLength(descriptionXml))
            .send(descriptionXml);
    });
}
