/**
 * The fleet-wide reason text for "the adapter itself has nothing to report":
 * off, or started and not serving yet. One word, identical in every adapter —
 * krobi 2026-08-27: "I don't want to see a different message in every adapter".
 * Defined once here and used at every lifecycle point.
 */
export const REASON_UNKNOWN = "Unknown";

/**
 * A start-up failure hueemu diagnosed about ITS OWN configuration (no port, no
 * routable host, colliding ports).
 *
 * The class exists for one reason: its message is the adapter's own wording, and
 * the reason datapoint must never carry that (fleet rule, see
 * {@link REASON_UNKNOWN}). `onReady` maps this type to `Unknown` for the
 * datapoint and logs the full text, where an actionable hint belongs. An error
 * that came from outside — node's `listen EADDRINUSE …`, a library — is nobody's
 * invention and reaches the datapoint unchanged.
 */
export class ConfigurationError extends Error {
  /**
   * @param message The adapter's own description of the misconfiguration —
   *   log-only, never the value of the reason datapoint.
   */
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Hue API Error types and handling
 */

/**
 * Hue API error types as defined in the Hue API specification. This is the
 * full spec catalog kept as the documented Hue error-type mapping; the
 * emulator only constructs the subset it actually returns.
 */
export enum HueErrorType {
  UNAUTHORIZED_USER = 1,
  INVALID_JSON = 2,
  RESOURCE_NOT_AVAILABLE = 3,
  METHOD_NOT_AVAILABLE = 4,
  MISSING_PARAMETERS = 5,
  PARAMETER_NOT_AVAILABLE = 6,
  INVALID_PARAMETER_VALUE = 7,
  PARAMETER_NOT_MODIFIABLE = 8,
  INTERNAL_ERROR = 901,
  LINK_BUTTON_NOT_PRESSED = 101,
  DHCP_CANNOT_BE_DISABLED = 110,
  INVALID_UPDATE_STATE = 111,
  DEVICE_IS_OFF = 201,
  GROUP_TABLE_FULL = 301,
  LIGHT_LIST_FULL = 302,
  DEVICE_IS_NOT_MODIFIABLE = 303,
}

/**
 * Human-readable error descriptions
 */
const ERROR_DESCRIPTIONS: Record<HueErrorType, string> = {
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
 * Hue API error response format
 */
export interface HueErrorResponse {
  /** Error details */
  error: {
    type: number;
    address: string;
    description: string;
  };
}

/**
 * Custom error class for Hue API errors
 */
export class HueApiError extends Error {
  public readonly type: HueErrorType;
  public readonly address: string;

  private constructor(type: HueErrorType, address: string, params: string[] = []) {
    const description = HueApiError.formatDescription(type, params);
    super(description);
    this.type = type;
    this.address = address;
    this.name = "HueApiError";
  }

  /**
   * Format error description with parameters
   *
   * @param type - Hue error type enum value
   * @param params - Substitution parameters for the error template
   */
  private static formatDescription(type: HueErrorType, params: string[]): string {
    let desc = ERROR_DESCRIPTIONS[type] || "unknown error";
    params.forEach((param, index) => {
      // Function replacer: a plain-string replacement honours $&, $', $` and $$
      // patterns inside `param`, which would corrupt the output (and can leak the
      // raw {index} template back to the client). A replacer function is immune.
      desc = desc.replace(`{${index}}`, () => param);
    });
    return desc;
  }

  /**
   * Convert to Hue API error response format
   */
  public toResponse(): HueErrorResponse {
    return {
      error: {
        type: this.type,
        address: this.address,
        description: this.message,
      },
    };
  }

  // Static factory methods for common errors

  /**
   * Create an unauthorized user error
   *
   * @param address - API endpoint address
   */
  static unauthorizedUser(address = ""): HueApiError {
    return new HueApiError(HueErrorType.UNAUTHORIZED_USER, address);
  }

  /**
   * Create an invalid JSON error
   *
   * @param address - API endpoint address
   */
  static invalidJson(address = ""): HueApiError {
    return new HueApiError(HueErrorType.INVALID_JSON, address);
  }

  /**
   * Create a resource not available error
   *
   * @param resource - Resource identifier
   * @param address - API endpoint address
   */
  static resourceNotAvailable(resource: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.RESOURCE_NOT_AVAILABLE, address, [resource]);
  }

  /**
   * Create a "parameter not available" error — the bridge's answer to an
   * attribute no light state has (`{"foo": 1}` → `parameter, foo, not available`).
   *
   * @param parameter - The unknown attribute name
   * @param address - API endpoint address
   */
  static parameterNotAvailable(parameter: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.PARAMETER_NOT_AVAILABLE, address, [parameter]);
  }

  /**
   * Create a "method not available" error — the bridge's answer to a method a
   * resource does not offer (`GET /api` → `method, GET, not available for resource, /`).
   *
   * @param method - The HTTP method
   * @param resource - The resource path
   * @param address - API endpoint address
   */
  static methodNotAvailable(method: string, resource: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.METHOD_NOT_AVAILABLE, address, [method, resource]);
  }

  /**
   * Create an "invalid value" error (`invalid value, <value>, for parameter, <name>`).
   *
   * @param value - The value the client sent, as text
   * @param parameter - The parameter name
   * @param address - API endpoint address
   */
  static invalidParameterValue(value: string, parameter: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.INVALID_PARAMETER_VALUE, address, [value, parameter]);
  }

  /**
   * Create a "parameter not modifiable" error (`parameter, <name>, is not modifiable`) —
   * the bridge's answer to a read-only attribute such as `colormode`.
   *
   * @param parameter - The attribute name
   * @param address - API endpoint address
   */
  static parameterNotModifiable(parameter: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.PARAMETER_NOT_MODIFIABLE, address, [parameter]);
  }

  /**
   * Create the "device is set to off" error — the bridge's answer to a light
   * attribute sent to a light that is (being switched) off.
   *
   * @param parameter - The attribute name
   * @param address - API endpoint address
   */
  static deviceIsOff(parameter: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.DEVICE_IS_OFF, address, [parameter]);
  }

  /**
   * Create a missing parameters error
   *
   * @param address - API endpoint address
   */
  static missingParameters(address = ""): HueApiError {
    return new HueApiError(HueErrorType.MISSING_PARAMETERS, address);
  }

  /**
   * Create a link button not pressed error
   *
   * @param address - API endpoint address
   */
  static linkButtonNotPressed(address = ""): HueApiError {
    return new HueApiError(HueErrorType.LINK_BUTTON_NOT_PRESSED, address);
  }

  /**
   * Create an internal error
   *
   * @param details - Error details message
   * @param address - API endpoint address
   */
  static internalError(details: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.INTERNAL_ERROR, address, [details]);
  }
}
