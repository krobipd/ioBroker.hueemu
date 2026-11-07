import { render } from "@testing-library/react";
import { ConfigGeneric } from "@iobroker/json-config";
import { afterEach, describe, expect, it } from "vitest";

import Components from "./Components";
import { DevicesTabMemory } from "./DevicesConfig";

// json-config remembers the last tab per adapter under `App.<adapter>` and writes it on every tab switch.
const KEY = "App.hueemu";

describe("DevicesTabMemory", () => {
  afterEach(() => localStorage.clear());

  it("forgets the devices tab the admin just remembered, so the settings open on the first tab", () => {
    localStorage.setItem(KEY, "devicesTab");
    const { getByTestId } = render(<DevicesTabMemory namespace="hueemu.0" />);
    expect(getByTestId("hueemu-devices-tab")).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("forgets the tab again when the settings close", () => {
    const view = render(<DevicesTabMemory namespace="hueemu.0" />);
    localStorage.setItem(KEY, "networkTab");
    view.unmount();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("leaves another adapter's remembered tab alone", () => {
    localStorage.setItem("App.other", "devicesTab");
    render(<DevicesTabMemory namespace="hueemu.0" />);
    expect(localStorage.getItem("App.other")).toBe("devicesTab");
  });
});

describe("Components", () => {
  it("exposes the devices mount the jsonConfig names, as a ConfigGeneric the admin can drive", () => {
    expect(Components.DevicesConfig.prototype).toBeInstanceOf(ConfigGeneric);
  });

  it("hands the instance namespace from the admin context to the tab memory", () => {
    localStorage.setItem("App.hueemu", "devicesTab");
    const element = Components.DevicesConfig.prototype.renderItem.call(
      { props: { oContext: { adapterName: "hueemu", instance: 1 } } } as unknown as InstanceType<
        typeof Components.DevicesConfig
      >,
      "",
      false,
    );
    expect(element.props).toEqual({ namespace: "hueemu.1" });
    render(element);
    expect(localStorage.getItem("App.hueemu")).toBeNull();
  });
});
