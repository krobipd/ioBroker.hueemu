"use strict";
/**
 * Hue API Error types and handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HueApiError = exports.HueErrorType = void 0;
/**
 * Hue API error types as defined in the Hue API specification
 */
var HueErrorType;
(function (HueErrorType) {
    HueErrorType[HueErrorType["UNAUTHORIZED_USER"] = 1] = "UNAUTHORIZED_USER";
    HueErrorType[HueErrorType["INVALID_JSON"] = 2] = "INVALID_JSON";
    HueErrorType[HueErrorType["RESOURCE_NOT_AVAILABLE"] = 3] = "RESOURCE_NOT_AVAILABLE";
    HueErrorType[HueErrorType["METHOD_NOT_AVAILABLE"] = 4] = "METHOD_NOT_AVAILABLE";
    HueErrorType[HueErrorType["MISSING_PARAMETERS"] = 5] = "MISSING_PARAMETERS";
    HueErrorType[HueErrorType["PARAMETER_NOT_AVAILABLE"] = 6] = "PARAMETER_NOT_AVAILABLE";
    HueErrorType[HueErrorType["INVALID_PARAMETER_VALUE"] = 7] = "INVALID_PARAMETER_VALUE";
    HueErrorType[HueErrorType["PARAMETER_NOT_MODIFIABLE"] = 8] = "PARAMETER_NOT_MODIFIABLE";
    HueErrorType[HueErrorType["INTERNAL_ERROR"] = 901] = "INTERNAL_ERROR";
    HueErrorType[HueErrorType["LINK_BUTTON_NOT_PRESSED"] = 101] = "LINK_BUTTON_NOT_PRESSED";
    HueErrorType[HueErrorType["DHCP_CANNOT_BE_DISABLED"] = 110] = "DHCP_CANNOT_BE_DISABLED";
    HueErrorType[HueErrorType["INVALID_UPDATE_STATE"] = 111] = "INVALID_UPDATE_STATE";
    HueErrorType[HueErrorType["DEVICE_IS_OFF"] = 201] = "DEVICE_IS_OFF";
    HueErrorType[HueErrorType["GROUP_TABLE_FULL"] = 301] = "GROUP_TABLE_FULL";
    HueErrorType[HueErrorType["LIGHT_LIST_FULL"] = 302] = "LIGHT_LIST_FULL";
    HueErrorType[HueErrorType["DEVICE_IS_NOT_MODIFIABLE"] = 303] = "DEVICE_IS_NOT_MODIFIABLE";
})(HueErrorType || (exports.HueErrorType = HueErrorType = {}));
/**
 * Human-readable error descriptions
 */
const ERROR_DESCRIPTIONS = {
    [HueErrorType.UNAUTHORIZED_USER]: "unauthorized user",
    [HueErrorType.INVALID_JSON]: "body contains invalid JSON",
    [HueErrorType.RESOURCE_NOT_AVAILABLE]: "resource, {0}, not available",
    [HueErrorType.METHOD_NOT_AVAILABLE]: "method, {0}, not available for resource, {1}",
    [HueErrorType.MISSING_PARAMETERS]: "missing parameters in body",
    [HueErrorType.PARAMETER_NOT_AVAILABLE]: "parameter, {0}, not available",
    [HueErrorType.INVALID_PARAMETER_VALUE]: "invalid value, {0}, for parameter, {1}",
    [HueErrorType.PARAMETER_NOT_MODIFIABLE]: "parameter, {0}, is not modifiable",
    [HueErrorType.INTERNAL_ERROR]: "internal error, {0}",
    [HueErrorType.LINK_BUTTON_NOT_PRESSED]: "link button not pressed",
    [HueErrorType.DHCP_CANNOT_BE_DISABLED]: "DHCP cannot be disabled",
    [HueErrorType.INVALID_UPDATE_STATE]: "invalid update state",
    [HueErrorType.DEVICE_IS_OFF]: "parameter, {0}, is not modifiable. Device is set to off.",
    [HueErrorType.GROUP_TABLE_FULL]: "group table full",
    [HueErrorType.LIGHT_LIST_FULL]: "light list full",
    [HueErrorType.DEVICE_IS_NOT_MODIFIABLE]: "device, {0}, is not modifiable",
};
/**
 * Custom error class for Hue API errors
 */
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
                description: this.message,
            },
        };
    }
    // Static factory methods for common errors
    static unauthorizedUser(address = "") {
        return new HueApiError(HueErrorType.UNAUTHORIZED_USER, address);
    }
    static invalidJson(address = "") {
        return new HueApiError(HueErrorType.INVALID_JSON, address);
    }
    static resourceNotAvailable(resource, address = "") {
        return new HueApiError(HueErrorType.RESOURCE_NOT_AVAILABLE, address, [
            resource,
        ]);
    }
    static methodNotAvailable(method, resource, address = "") {
        return new HueApiError(HueErrorType.METHOD_NOT_AVAILABLE, address, [
            method,
            resource,
        ]);
    }
    static missingParameters(address = "") {
        return new HueApiError(HueErrorType.MISSING_PARAMETERS, address);
    }
    static parameterNotAvailable(parameter, address = "") {
        return new HueApiError(HueErrorType.PARAMETER_NOT_AVAILABLE, address, [
            parameter,
        ]);
    }
    static invalidParameterValue(value, parameter, address = "") {
        return new HueApiError(HueErrorType.INVALID_PARAMETER_VALUE, address, [
            value,
            parameter,
        ]);
    }
    static linkButtonNotPressed(address = "") {
        return new HueApiError(HueErrorType.LINK_BUTTON_NOT_PRESSED, address);
    }
    static internalError(details, address = "") {
        return new HueApiError(HueErrorType.INTERNAL_ERROR, address, [details]);
    }
}
exports.HueApiError = HueApiError;
//# sourceMappingURL=errors.js.map