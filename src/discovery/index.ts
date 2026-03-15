/**
 * Discovery module exports
 */

export { HueSsdpServer, type SsdpServerConfig } from "./ssdp-server";
export {
  generateDescriptionXml,
  getDescriptionUrl,
  generateSsdpHeaders,
  type DescriptionXmlOptions,
} from "./description-xml";
