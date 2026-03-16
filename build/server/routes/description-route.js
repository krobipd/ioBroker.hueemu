"use strict";
/**
 * UPnP Description XML route
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.descriptionRoute = descriptionRoute;
const discovery_1 = require("../../discovery");
/**
 * Fastify plugin that registers the /description.xml route
 */
function descriptionRoute(fastify, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const { descriptionOptions } = options;
        // Generate the XML once (it's static)
        const descriptionXml = (0, discovery_1.generateDescriptionXml)(descriptionOptions);
        fastify.get("/description.xml", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            reply
                .type("application/xml")
                .header("Content-Length", Buffer.byteLength(descriptionXml))
                .send(descriptionXml);
        }));
    });
}
