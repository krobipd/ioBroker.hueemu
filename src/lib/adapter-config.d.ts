// This file extends the AdapterConfig type from "@iobroker/types" (the create-adapter layout).

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      // The listen address — the fleet-standard key the admin's port-conflict check reads
      // together with `port` (v1.18.0; `host` until v1.17.1, migrated on the first start).
      bind: string;
      port: number;
      httpsPort: number | undefined;
      trustProxy?: boolean;
      // A setting of the page: empty, the MAC is derived from the UDN on every start.
      mac: string;
      // Up to v1.19.0 the bridge identity lived here; since audit R-24 it is a file in the
      // instance data folder (identity-store.ts). Read once to take it over, then dropped.
      udn?: unknown;
      tlsCert?: unknown;
      tlsKey?: unknown;
      // Up to v1.19.0 the lights and the highest light number ever handed out lived here;
      // since audit R-24 the lights are own device objects (`lights.<n>`, light-store.ts) and
      // the mark a file in the instance data folder. Read once to move them, then dropped.
      devices?: unknown;
      lastLightId?: unknown;
    }
  }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
