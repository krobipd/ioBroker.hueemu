import React from "react";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";

import { forgetLastTab } from "./tabMemory";

/**
 * Forgets the open tab whenever the devices tab is entered or the settings close, so the next visit to the settings
 * starts on the first tab "Configuration" (GV-07). It shows nothing; its marker is one pixel high because the render
 * gate (D07) waits for an element the browser counts as shown, and an empty element has no height.
 *
 * @param props the component props
 * @param props.namespace the instance, e.g. `hueemu.0`
 * @returns the marker element
 */
export function DevicesTabMemory({ namespace }: { namespace: string }): React.JSX.Element {
  React.useEffect(() => {
    forgetLastTab(namespace, ["networkTab", "devicesTab"]);
    return () => forgetLastTab(namespace, ["networkTab", "devicesTab"]);
  }, [namespace]);
  return (
    <div
      data-testid="hueemu-devices-tab"
      style={{ minHeight: 1 }}
    />
  );
}

/**
 * jsonConfig `type: custom` mount point on the devices tab. Must extend {@link ConfigGeneric} — the admin
 * instantiates the exposed class and drives it through `renderItem`; it owns no native field.
 */
export default class DevicesConfig extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
  /**
   * The tab memory of this instance.
   *
   * @param _error unused — the component has no field
   * @param _disabled unused — the component has no field
   * @returns the marker element
   */
  renderItem(_error: string, _disabled: boolean): React.JSX.Element {
    const ctx = this.props.oContext;
    return <DevicesTabMemory namespace={`${ctx.adapterName}.${ctx.instance}`} />;
  }
}
