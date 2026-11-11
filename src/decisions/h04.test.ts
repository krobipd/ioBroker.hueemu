/**
 * Guard H-04 — every change of a mapped datapoint reaches the bridge, also one with ack: false.
 *
 * krobi 2026-09-15, on the audit's question about unconfirmed values: "C1 (b) take over ack:false" (wording from the
 * AI's project note of that day; the conversation is no longer stored). The page, H-04: "A light hangs on a datapoint of
 * its own that a script switches. The script switches on, so the bridge shows the light as on."; before "Only confirmed
 * values counted. Such a light stood still in the bridge."
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in) receives the state change and hands
 * it to the bridge's handler, which serves the light.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The stand-in's database. */
const db = vi.hoisted(() => ({
  objects: new Map<string, Record<string, unknown>>(),
  states: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@iobroker/adapter-core", () => {
  const full = (id: string): string => (id.startsWith("hueemu.0.") ? id : `hueemu.0.${id}`);
  const noop = (): void => undefined;
  class Adapter {
    public namespace = "hueemu.0";
    public config = {};
    public log = { silly: noop, debug: noop, info: noop, warn: noop, error: noop, level: "info" };
    public on(): void {
      // the guard calls the handler itself
    }
    public setState(id: string, state: Record<string, unknown>): Promise<string> {
      db.states.set(full(id), { ...state, ts: Date.now(), lc: Date.now() });
      return Promise.resolve(id);
    }
    public getForeignStateAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.states.get(id) ?? null));
    }
    public getForeignObjectAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.objects.get(id) ?? null));
    }
    public setForeignStateAsync(id: string, state: Record<string, unknown>): Promise<string> {
      db.states.set(id, { ...state });
      return Promise.resolve(id);
    }
    public subscribeForeignStates(): void {
      // the guard delivers the change itself
    }
    public unsubscribeForeignStates(): void {
      // nothing ends in this guard
    }
  }
  return {
    Adapter,
    getAbsoluteInstanceDataDir: () => "",
    I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
  };
});

import * as mainModule from "../main";
import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import { ClientStore } from "../lib/client-store";

const { HueEmu } = mainModule as unknown as { HueEmu: new () => ApiHandlerAdapter };

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
  db.objects.clear();
  db.states.clear();
});

describe("H-04: every change of a mapped datapoint reaches the bridge", () => {
  it("shows the light as on after a script switched its datapoint without confirmation", async () => {
    db.objects.set("javascript.0.lamp", {
      _id: "javascript.0.lamp",
      type: "state",
      common: { name: "lamp", type: "boolean", role: "switch.light", read: true, write: true },
      native: {},
    });
    db.states.set("javascript.0.lamp", { val: false, ack: true, ts: 1, lc: 1, from: "system.adapter.javascript.0" });
    const adapter = new HueEmu();
    const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-h04-"));
    folders.push(folder);
    const clients = new ClientStore(folder);
    clients.load();
    const handler = new ApiHandler({
      adapter,
      configServiceConfig: {
        identity: {
          udn: "11111111-2222-3333-4444-555555555555",
          mac: "aa:bb:cc:dd:ee:ff",
          bridgeId: "AABBCCFFFEDDEEFF",
          modelId: "BSB002",
          serialNumber: "aabbccddeeff",
        },
        advertiseHost: "192.168.1.10",
      },
      devices: [{ id: 1, name: "Lamp", lightType: "onoff", onState: "javascript.0.lamp" }],
      logger: adapter.log,
      clients,
    });
    await handler.initialize();
    const internals = adapter as unknown as {
      apiHandler: ApiHandler | null;
      onStateChange(id: string, state: ioBroker.State): void;
    };
    internals.apiHandler = handler;
    const before = (await handler.getLightById("1")).state.on;
    internals.onStateChange("javascript.0.lamp", {
      val: true,
      ack: false,
      ts: 2,
      lc: 2,
      from: "system.adapter.javascript.0",
      q: 0,
    });
    const after = (await handler.getLightById("1")).state.on;

    expect({ before, after }).toEqual({ before: false, after: true });
  });
});
