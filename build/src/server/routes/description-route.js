"use strict";
/**
 * UPnP Description XML route
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.descriptionRoute = descriptionRoute;
const discovery_1 = require("../../discovery");
/**
 * Fastify plugin that registers the /description.xml route
 */
async function descriptionRoute(fastify, options) {
    const { descriptionOptions } = options;
    // Generate the XML once (it's static)
    const descriptionXml = (0, discovery_1.generateDescriptionXml)(descriptionOptions);
    fastify.get("/description.xml", async (_request, reply) => {
        reply
            .type("application/xml")
            .header("Content-Length", Buffer.byteLength(descriptionXml))
            .send(descriptionXml);
    });
}
//# sourceMappingURL=description-route.js.map