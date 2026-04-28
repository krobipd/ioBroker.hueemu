/**
 * Tests for HueApiError and error handler utilities
 */

import { expect } from "chai";
import { HueApiError, HueErrorType } from "./errors";
import { createSuccessResponse } from "../server/middleware/error-handler";

describe("HueApiError", () => {
  describe("factory methods", () => {
    it("should create unauthorizedUser error", () => {
      const err = HueApiError.unauthorizedUser("/api/test");
      expect(err).to.be.instanceOf(HueApiError);
      expect(err).to.be.instanceOf(Error);
      expect(err.type).to.equal(HueErrorType.UNAUTHORIZED_USER);
      expect(err.address).to.equal("/api/test");
      expect(err.message).to.equal("unauthorized user");
      expect(err.name).to.equal("HueApiError");
    });

    it("should create invalidJson error", () => {
      const err = HueApiError.invalidJson("/api/lights");
      expect(err.type).to.equal(HueErrorType.INVALID_JSON);
      expect(err.message).to.equal("body contains invalid JSON");
    });

    it("should create resourceNotAvailable error with parameter substitution", () => {
      const err = HueApiError.resourceNotAvailable("42", "/lights/42");
      expect(err.type).to.equal(HueErrorType.RESOURCE_NOT_AVAILABLE);
      expect(err.message).to.equal("resource, 42, not available");
      expect(err.address).to.equal("/lights/42");
    });

    it("should create methodNotAvailable error with two parameters", () => {
      const err = HueApiError.methodNotAvailable("DELETE", "/lights", "/api");
      expect(err.type).to.equal(HueErrorType.METHOD_NOT_AVAILABLE);
      expect(err.message).to.equal(
        "method, DELETE, not available for resource, /lights",
      );
    });

    it("should create missingParameters error", () => {
      const err = HueApiError.missingParameters("/api");
      expect(err.type).to.equal(HueErrorType.MISSING_PARAMETERS);
      expect(err.message).to.equal("missing parameters in body");
    });

    it("should create parameterNotAvailable error", () => {
      const err = HueApiError.parameterNotAvailable("xyz", "/lights/1/state");
      expect(err.type).to.equal(HueErrorType.PARAMETER_NOT_AVAILABLE);
      expect(err.message).to.equal("parameter, xyz, not available");
    });

    it("should create invalidParameterValue error", () => {
      const err = HueApiError.invalidParameterValue(
        "999",
        "bri",
        "/lights/1/state",
      );
      expect(err.type).to.equal(HueErrorType.INVALID_PARAMETER_VALUE);
      expect(err.message).to.equal("invalid value, 999, for parameter, bri");
    });

    it("should create linkButtonNotPressed error", () => {
      const err = HueApiError.linkButtonNotPressed("/api");
      expect(err.type).to.equal(HueErrorType.LINK_BUTTON_NOT_PRESSED);
      expect(err.message).to.equal("link button not pressed");
    });

    it("should create internalError error", () => {
      const err = HueApiError.internalError("something broke", "/api");
      expect(err.type).to.equal(HueErrorType.INTERNAL_ERROR);
      expect(err.message).to.equal("internal error, something broke");
    });

    it("should use empty string as default address", () => {
      const err = HueApiError.unauthorizedUser();
      expect(err.address).to.equal("");
    });
  });

  describe("toResponse", () => {
    it("should format as Hue API error response", () => {
      const err = HueApiError.unauthorizedUser("/api/baduser/lights");
      const response = err.toResponse();

      expect(response).to.deep.equal({
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

      expect(response.error.type).to.equal(3);
      expect(response.error.description).to.equal(
        "resource, 99, not available",
      );
      expect(response.error.address).to.equal("/lights/99");
    });
  });

  describe("error type enum values", () => {
    it("should have correct numeric values", () => {
      expect(HueErrorType.UNAUTHORIZED_USER).to.equal(1);
      expect(HueErrorType.INVALID_JSON).to.equal(2);
      expect(HueErrorType.RESOURCE_NOT_AVAILABLE).to.equal(3);
      expect(HueErrorType.METHOD_NOT_AVAILABLE).to.equal(4);
      expect(HueErrorType.MISSING_PARAMETERS).to.equal(5);
      expect(HueErrorType.PARAMETER_NOT_AVAILABLE).to.equal(6);
      expect(HueErrorType.INVALID_PARAMETER_VALUE).to.equal(7);
      expect(HueErrorType.PARAMETER_NOT_MODIFIABLE).to.equal(8);
      expect(HueErrorType.INTERNAL_ERROR).to.equal(901);
      expect(HueErrorType.LINK_BUTTON_NOT_PRESSED).to.equal(101);
      expect(HueErrorType.DEVICE_IS_OFF).to.equal(201);
    });
  });
});

describe("createSuccessResponse", () => {
  it("should wrap data in success array", () => {
    const response = createSuccessResponse({ username: "test123" });
    expect(response).to.deep.equal([{ success: { username: "test123" } }]);
  });

  it("should handle empty data", () => {
    const response = createSuccessResponse({});
    expect(response).to.deep.equal([{ success: {} }]);
  });

  it("should handle multiple keys", () => {
    const response = createSuccessResponse({ key1: "val1", key2: 42 });
    expect(response).to.deep.equal([{ success: { key1: "val1", key2: 42 } }]);
  });
});
