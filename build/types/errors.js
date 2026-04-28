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
var errors_exports = {};
__export(errors_exports, {
  HueApiError: () => HueApiError,
  HueErrorType: () => HueErrorType
});
module.exports = __toCommonJS(errors_exports);
var HueErrorType = /* @__PURE__ */ ((HueErrorType2) => {
  HueErrorType2[HueErrorType2["UNAUTHORIZED_USER"] = 1] = "UNAUTHORIZED_USER";
  HueErrorType2[HueErrorType2["INVALID_JSON"] = 2] = "INVALID_JSON";
  HueErrorType2[HueErrorType2["RESOURCE_NOT_AVAILABLE"] = 3] = "RESOURCE_NOT_AVAILABLE";
  HueErrorType2[HueErrorType2["METHOD_NOT_AVAILABLE"] = 4] = "METHOD_NOT_AVAILABLE";
  HueErrorType2[HueErrorType2["MISSING_PARAMETERS"] = 5] = "MISSING_PARAMETERS";
  HueErrorType2[HueErrorType2["PARAMETER_NOT_AVAILABLE"] = 6] = "PARAMETER_NOT_AVAILABLE";
  HueErrorType2[HueErrorType2["INVALID_PARAMETER_VALUE"] = 7] = "INVALID_PARAMETER_VALUE";
  HueErrorType2[HueErrorType2["PARAMETER_NOT_MODIFIABLE"] = 8] = "PARAMETER_NOT_MODIFIABLE";
  HueErrorType2[HueErrorType2["INTERNAL_ERROR"] = 901] = "INTERNAL_ERROR";
  HueErrorType2[HueErrorType2["LINK_BUTTON_NOT_PRESSED"] = 101] = "LINK_BUTTON_NOT_PRESSED";
  HueErrorType2[HueErrorType2["DHCP_CANNOT_BE_DISABLED"] = 110] = "DHCP_CANNOT_BE_DISABLED";
  HueErrorType2[HueErrorType2["INVALID_UPDATE_STATE"] = 111] = "INVALID_UPDATE_STATE";
  HueErrorType2[HueErrorType2["DEVICE_IS_OFF"] = 201] = "DEVICE_IS_OFF";
  HueErrorType2[HueErrorType2["GROUP_TABLE_FULL"] = 301] = "GROUP_TABLE_FULL";
  HueErrorType2[HueErrorType2["LIGHT_LIST_FULL"] = 302] = "LIGHT_LIST_FULL";
  HueErrorType2[HueErrorType2["DEVICE_IS_NOT_MODIFIABLE"] = 303] = "DEVICE_IS_NOT_MODIFIABLE";
  return HueErrorType2;
})(HueErrorType || {});
const ERROR_DESCRIPTIONS = {
  [1 /* UNAUTHORIZED_USER */]: "unauthorized user",
  [2 /* INVALID_JSON */]: "body contains invalid JSON",
  [3 /* RESOURCE_NOT_AVAILABLE */]: "resource, {0}, not available",
  [4 /* METHOD_NOT_AVAILABLE */]: "method, {0}, not available for resource, {1}",
  [5 /* MISSING_PARAMETERS */]: "missing parameters in body",
  [6 /* PARAMETER_NOT_AVAILABLE */]: "parameter, {0}, not available",
  [7 /* INVALID_PARAMETER_VALUE */]: "invalid value, {0}, for parameter, {1}",
  [8 /* PARAMETER_NOT_MODIFIABLE */]: "parameter, {0}, is not modifiable",
  [901 /* INTERNAL_ERROR */]: "internal error, {0}",
  [101 /* LINK_BUTTON_NOT_PRESSED */]: "link button not pressed",
  [110 /* DHCP_CANNOT_BE_DISABLED */]: "DHCP cannot be disabled",
  [111 /* INVALID_UPDATE_STATE */]: "invalid update state",
  [201 /* DEVICE_IS_OFF */]: "parameter, {0}, is not modifiable. Device is set to off.",
  [301 /* GROUP_TABLE_FULL */]: "group table full",
  [302 /* LIGHT_LIST_FULL */]: "light list full",
  [303 /* DEVICE_IS_NOT_MODIFIABLE */]: "device, {0}, is not modifiable"
};
class HueApiError extends Error {
  type;
  address;
  params;
  constructor(type, address, params = []) {
    const description = HueApiError.formatDescription(type, params);
    super(description);
    this.type = type;
    this.address = address;
    this.params = params;
    this.name = "HueApiError";
  }
  /**
   * Format error description with parameters
   */
  static formatDescription(type, params) {
    let desc = ERROR_DESCRIPTIONS[type] || "unknown error";
    params.forEach((param, index) => {
      desc = desc.replace(`{${index}}`, param);
    });
    return desc;
  }
  /**
   * Convert to Hue API error response format
   */
  toResponse() {
    return {
      error: {
        type: this.type,
        address: this.address,
        description: this.message
      }
    };
  }
  // Static factory methods for common errors
  static unauthorizedUser(address = "") {
    return new HueApiError(1 /* UNAUTHORIZED_USER */, address);
  }
  static invalidJson(address = "") {
    return new HueApiError(2 /* INVALID_JSON */, address);
  }
  static resourceNotAvailable(resource, address = "") {
    return new HueApiError(3 /* RESOURCE_NOT_AVAILABLE */, address, [resource]);
  }
  static methodNotAvailable(method, resource, address = "") {
    return new HueApiError(4 /* METHOD_NOT_AVAILABLE */, address, [method, resource]);
  }
  static missingParameters(address = "") {
    return new HueApiError(5 /* MISSING_PARAMETERS */, address);
  }
  static parameterNotAvailable(parameter, address = "") {
    return new HueApiError(6 /* PARAMETER_NOT_AVAILABLE */, address, [parameter]);
  }
  static invalidParameterValue(value, parameter, address = "") {
    return new HueApiError(7 /* INVALID_PARAMETER_VALUE */, address, [value, parameter]);
  }
  static linkButtonNotPressed(address = "") {
    return new HueApiError(101 /* LINK_BUTTON_NOT_PRESSED */, address);
  }
  static internalError(details, address = "") {
    return new HueApiError(901 /* INTERNAL_ERROR */, address, [details]);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueApiError,
  HueErrorType
});
//# sourceMappingURL=errors.js.map
