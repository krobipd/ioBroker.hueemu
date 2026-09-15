import { assignDeviceIds, isDeviceId, nextDeviceId } from "./device-ids";
import type { DeviceConfig } from "../hue-api";

const light = (name: string, id?: number): DeviceConfig => ({
  ...(id === undefined ? {} : { id }),
  name,
  lightType: "onoff",
});

describe("isDeviceId", () => {
  it("accepts positive integers only", () => {
    expect(isDeviceId(1)).toBe(true);
    expect(isDeviceId(300)).toBe(true);
    expect(isDeviceId(0)).toBe(false);
    expect(isDeviceId(-1)).toBe(false);
    expect(isDeviceId(1.5)).toBe(false);
    expect(isDeviceId("1")).toBe(false);
    expect(isDeviceId(undefined)).toBe(false);
    expect(isDeviceId(Number.NaN)).toBe(false);
  });
});

describe("assignDeviceIds", () => {
  // The first assignment is the position: an installation that updates keeps
  // light 3 as light 3, so nothing changes for its paired clients.
  it("numbers an unnumbered list by position", () => {
    const { devices, changed } = assignDeviceIds([light("A"), light("B"), light("C")]);
    expect(changed).toBe(true);
    expect(devices.map(d => d.id)).toEqual([1, 2, 3]);
  });

  it("returns the very same list, unchanged, when every entry is numbered", () => {
    const input = [light("A", 1), light("B", 5)];
    const { devices, changed } = assignDeviceIds(input);
    expect(changed).toBe(false);
    expect(devices).toBe(input);
  });

  it("is idempotent on its own output", () => {
    const first = assignDeviceIds([light("A"), light("B", 4), light("C")]);
    const second = assignDeviceIds(first.devices);
    expect(second.changed).toBe(false);
    expect(second.devices).toEqual(first.devices);
  });

  it("continues above the highest number in use when some entries are numbered", () => {
    const { devices } = assignDeviceIds([light("A"), light("B", 4), light("C")]);
    expect(devices.map(d => d.id)).toEqual([5, 4, 6]);
  });

  it("keeps the first of two entries with the same number and renumbers the second", () => {
    const { devices } = assignDeviceIds([light("A", 2), light("B", 2)]);
    expect(devices.map(d => d.id)).toEqual([2, 3]);
  });

  it("treats an unusable number like a missing one", () => {
    const { devices } = assignDeviceIds([light("A", 0), light("B", 7)]);
    expect(devices.map(d => d.id)).toEqual([8, 7]);
  });

  it("does not mutate the entries it numbers", () => {
    const a = light("A");
    assignDeviceIds([a]);
    expect(a.id).toBeUndefined();
  });
});

describe("nextDeviceId", () => {
  it("is one above the highest number in use", () => {
    expect(nextDeviceId([light("A", 1), light("B", 7), light("C", 3)])).toBe(8);
  });

  // A deleted light's number is gone for good — Alexa would otherwise take the
  // new light for the old one.
  it("never fills a gap", () => {
    expect(nextDeviceId([light("A", 1), light("C", 3)])).toBe(4);
  });

  it("is one above the list length for a list nobody numbered yet", () => {
    // The start-up migration will give those entries their positions 1..n.
    expect(nextDeviceId([light("A"), light("B")])).toBe(3);
    expect(nextDeviceId([])).toBe(1);
  });
});
