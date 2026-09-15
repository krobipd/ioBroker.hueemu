/**
 * v1.18.0 — permanent light numbers.
 *
 * Until v1.17.1 a light's Hue id and its `uniqueid` were its POSITION in
 * `native.devices`. Deleting or reordering a light therefore renumbered every
 * light behind it: after "kitchen" (light 1) was removed, "hall" answered as
 * light 1 with kitchen's `uniqueid`, and Alexa — which keys a device by that
 * `uniqueid` — switched the hall when asked for the kitchen (measured, audit
 * 2026-09-15 A4). Home Assistant's emulated_hue keeps a persistent id file for
 * exactly this reason.
 *
 * The number lives in the stored device entry (`DeviceConfig.id`): the first
 * assignment is the light's current position, so nothing changes for an
 * installation that updates; a new light gets `max + 1`; a number is never
 * reused — gaps are normal, a real bridge has them too. Pure helpers; the
 * persisting step is `runDeviceIdMigration` in `migrations.ts`.
 */

import type { DeviceConfig } from "../hue-api";

/**
 * A usable light number: a positive integer.
 *
 * @param id The stored value.
 */
export function isDeviceId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= 1;
}

/**
 * The number the next added light gets — one above every number in use AND
 * above the list length, so a light added to a list the migration has not
 * numbered yet cannot collide with the positions that migration will assign.
 *
 * @param devices The stored device configurations.
 */
export function nextDeviceId(devices: DeviceConfig[]): number {
  const highest = devices.reduce((max, d) => (isDeviceId(d.id) && d.id > max ? d.id : max), devices.length);
  return highest + 1;
}

/**
 * Give every device without a (valid, unique) number one. Pure and idempotent:
 * a list where every entry already carries a distinct number comes back
 * unchanged, so the caller can decide whether to write.
 *
 * @param devices The stored device configurations.
 * @returns The numbered list and whether anything had to change.
 */
export function assignDeviceIds(devices: DeviceConfig[]): { devices: DeviceConfig[]; changed: boolean } {
  const taken = new Set<number>();
  const missing = new Set<number>();
  devices.forEach((device, index) => {
    if (isDeviceId(device.id) && !taken.has(device.id)) {
      taken.add(device.id);
    } else {
      missing.add(index);
    }
  });
  if (missing.size === 0) {
    return { devices, changed: false };
  }
  // A list nobody numbered yet keeps its positions — light 3 stays light 3.
  // Anything else continues above the highest number in use.
  let next = taken.size === 0 ? 1 : Math.max(...taken) + 1;
  const numbered = devices.map((device, index) => {
    if (!missing.has(index)) {
      return device;
    }
    while (taken.has(next)) {
      next++;
    }
    taken.add(next);
    return { ...device, id: next++ };
  });
  return { devices: numbered, changed: true };
}
