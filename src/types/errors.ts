/**
 * Hue API Error types and handling
 */

/**
 * Hue API error types as defined in the Hue API specification
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
  public readonly params: string[];

  private constructor(type: HueErrorType, address: string, params: string[] = []) {
    const description = HueApiError.formatDescription(type, params);
    super(description);
    this.type = type;
    this.address = address;
    this.params = params;
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
      desc = desc.replace(`{${index}}`, param);
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
   * Create a method not available error
   *
   * @param method - HTTP method
   * @param resource - Resource identifier
   * @param address - API endpoint address
   */
  static methodNotAvailable(method: string, resource: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.METHOD_NOT_AVAILABLE, address, [method, resource]);
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
   * Create a parameter not available error
   *
   * @param parameter - Parameter name
   * @param address - API endpoint address
   */
  static parameterNotAvailable(parameter: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.PARAMETER_NOT_AVAILABLE, address, [parameter]);
  }

  /**
   * Create an invalid parameter value error
   *
   * @param value - Invalid value
   * @param parameter - Parameter name
   * @param address - API endpoint address
   */
  static invalidParameterValue(value: string, parameter: string, address = ""): HueApiError {
    return new HueApiError(HueErrorType.INVALID_PARAMETER_VALUE, address, [value, parameter]);
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
