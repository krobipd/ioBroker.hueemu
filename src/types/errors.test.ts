/**
 * Tests for HueApiError and error handler utilities
 */

import { HueApiError, HueErrorType } from "./errors";
import { createSuccessResponse } from "../server/middleware/error-handler";

describe("HueApiError", () => {
  describe("factory methods", () => {
    it("should create unauthorizedUser error", () => {
      const err = HueApiError.unauthorizedUser("/api/test");
      expect(err).toBeInstanceOf(HueApiError);
      expect(err).toBeInstanceOf(Error);
      expect(err.type).toBe(HueErrorType.UNAUTHORIZED_USER);
      expect(err.address).toBe("/api/test");
      expect(err.message).toBe("unauthorized user");
      expect(err.name).toBe("HueApiError");
    });

    it("should create invalidJson error", () => {
      const err = HueApiError.invalidJson("/api/lights");
      expect(err.type).toBe(HueErrorType.INVALID_JSON);
      expect(err.message).toBe("body contains invalid JSON");
    });

    it("should create resourceNotAvailable error with parameter substitution", () => {
      const err = HueApiError.resourceNotAvailable("42", "/lights/42");
      expect(err.type).toBe(HueErrorType.RESOURCE_NOT_AVAILABLE);
      expect(err.message).toBe("resource, 42, not available");
      expect(err.address).toBe("/lights/42");
    });

    it("should create methodNotAvailable error with two parameters", () => {
      const err = HueApiError.methodNotAvailable("DELETE", "/lights", "/api");
      expect(err.type).toBe(HueErrorType.METHOD_NOT_AVAILABLE);
      expect(err.message).toBe("method, DELETE, not available for resource, /lights");
    });

    it("should create missingParameters error", () => {
      const err = HueApiError.missingParameters("/api");
      expect(err.type).toBe(HueErrorType.MISSING_PARAMETERS);
      expect(err.message).toBe("missing parameters in body");
    });

    it("should create parameterNotAvailable error", () => {
      const err = HueApiError.parameterNotAvailable("xyz", "/lights/1/state");
      expect(err.type).toBe(HueErrorType.PARAMETER_NOT_AVAILABLE);
      expect(err.message).toBe("parameter, xyz, not available");
    });

    it("should create invalidParameterValue error", () => {
      const err = HueApiError.invalidParameterValue("999", "bri", "/lights/1/state");
      expect(err.type).toBe(HueErrorType.INVALID_PARAMETER_VALUE);
      expect(err.message).toBe("invalid value, 999, for parameter, bri");
    });

    it("should create linkButtonNotPressed error", () => {
      const err = HueApiError.linkButtonNotPressed("/api");
      expect(err.type).toBe(HueErrorType.LINK_BUTTON_NOT_PRESSED);
      expect(err.message).toBe("link button not pressed");
    });

    it("should create internalError error", () => {
      const err = HueApiError.internalError("something broke", "/api");
      expect(err.type).toBe(HueErrorType.INTERNAL_ERROR);
      expect(err.message).toBe("internal error, something broke");
    });

    it("should use empty string as default address", () => {
      const err = HueApiError.unauthorizedUser();
      expect(err.address).toBe("");
    });
  });

  describe("toResponse", () => {
    it("should format as Hue API error response", () => {
      const err = HueApiError.unauthorizedUser("/api/baduser/lights");
      const response = err.toResponse();

      expect(response).toEqual({
        error: {
          type: 1,
          address: "/api/baduser/lights",
          description: "unauthorized user",
        },
      });
    });

    it("should include substituted parameters in description", () => {
      const err = HueApiError.resourceNotAvailable("99", "/lights/99");
      const response = err.toResponse();

      expect(response.error.type).toBe(3);
      expect(response.error.description).toBe("resource, 99, not available");
      expect(response.error.address).toBe("/lights/99");
    });
  });

  describe("error type enum values", () => {
    it("should have correct numeric values", () => {
      expect(HueErrorType.UNAUTHORIZED_USER).toBe(1);
      expect(HueErrorType.INVALID_JSON).toBe(2);
      expect(HueErrorType.RESOURCE_NOT_AVAILABLE).toBe(3);
      expect(HueErrorType.METHOD_NOT_AVAILABLE).toBe(4);
      expect(HueErrorType.MISSING_PARAMETERS).toBe(5);
      expect(HueErrorType.PARAMETER_NOT_AVAILABLE).toBe(6);
      expect(HueErrorType.INVALID_PARAMETER_VALUE).toBe(7);
      expect(HueErrorType.PARAMETER_NOT_MODIFIABLE).toBe(8);
      expect(HueErrorType.INTERNAL_ERROR).toBe(901);
      expect(HueErrorType.LINK_BUTTON_NOT_PRESSED).toBe(101);
      expect(HueErrorType.DEVICE_IS_OFF).toBe(201);
    });
  });
});

describe("createSuccessResponse", () => {
  it("should wrap data in success array", () => {
    const response = createSuccessResponse({ username: "test123" });
    expect(response).toEqual([{ success: { username: "test123" } }]);
  });

  it("should handle empty data", () => {
    const response = createSuccessResponse({});
    expect(response).toEqual([{ success: {} }]);
  });

  it("should handle multiple keys", () => {
    const response = createSuccessResponse({ key1: "val1", key2: 42 });
    expect(response).toEqual([{ success: { key1: "val1", key2: 42 } }]);
  });
});
