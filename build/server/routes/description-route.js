"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var description_route_exports = {};
__export(description_route_exports, {
  descriptionRoute: () => descriptionRoute
});
module.exports = __toCommonJS(description_route_exports);
var import_discovery = require("../../discovery");
async function descriptionRoute(fastify, options) {
  const { descriptionOptions } = options;
  const descriptionXml = (0, import_discovery.generateDescriptionXml)(descriptionOptions);
  fastify.get("/description.xml", async (_request, reply) => {
    reply.type("application/xml").header("Content-Length", Buffer.byteLength(descriptionXml)).send(descriptionXml);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  descriptionRoute
});
//# sourceMappingURL=description-route.js.map
