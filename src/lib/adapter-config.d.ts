// This file extends the AdapterConfig type from "@iobroker/types" (the create-adapter layout).

import type { DeviceConfig } from "../hue-api";

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      // The listen address — the fleet-standard key the admin's port-conflict check reads
      // together with `port` (v1.18.0; `host` until v1.17.1, migrated on the first start).
      bind: string;
      port: number;
      httpsPort: number | undefined;
      tlsCert?: string;
      tlsKey?: string;
      trustProxy?: boolean;
      udn: string;
      mac: string;
      devices: DeviceConfig[];
      // v1.19.0: the highest light number ever handed out — written by the device
      // manager so a deleted light's number (and uniqueid) is never reused.
      lastLightId?: number;
    }
  }
}
