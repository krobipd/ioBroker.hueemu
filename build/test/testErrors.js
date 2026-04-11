"use strict";
/**
 * Tests for HueApiError and error handler utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const errors_1 = require("../src/types/errors");
const error_handler_1 = require("../src/server/middleware/error-handler");
describe("HueApiError", () => {
    describe("factory methods", () => {
        it("should create unauthorizedUser error", () => {
            const err = errors_1.HueApiError.unauthorizedUser("/api/test");
            (0, chai_1.expect)(err).to.be.instanceOf(errors_1.HueApiError);
            (0, chai_1.expect)(err).to.be.instanceOf(Error);
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.UNAUTHORIZED_USER);
            (0, chai_1.expect)(err.address).to.equal("/api/test");
            (0, chai_1.expect)(err.message).to.equal("unauthorized user");
            (0, chai_1.expect)(err.name).to.equal("HueApiError");
        });
        it("should create invalidJson error", () => {
            const err = errors_1.HueApiError.invalidJson("/api/lights");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.INVALID_JSON);
            (0, chai_1.expect)(err.message).to.equal("body contains invalid JSON");
        });
        it("should create resourceNotAvailable error with parameter substitution", () => {
            const err = errors_1.HueApiError.resourceNotAvailable("42", "/lights/42");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.RESOURCE_NOT_AVAILABLE);
            (0, chai_1.expect)(err.message).to.equal("resource, 42, not available");
            (0, chai_1.expect)(err.address).to.equal("/lights/42");
        });
        it("should create methodNotAvailable error with two parameters", () => {
            const err = errors_1.HueApiError.methodNotAvailable("DELETE", "/lights", "/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.METHOD_NOT_AVAILABLE);
            (0, chai_1.expect)(err.message).to.equal("method, DELETE, not available for resource, /lights");
        });
        it("should create missingParameters error", () => {
            const err = errors_1.HueApiError.missingParameters("/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.MISSING_PARAMETERS);
            (0, chai_1.expect)(err.message).to.equal("missing parameters in body");
        });
        it("should create parameterNotAvailable error", () => {
            const err = errors_1.HueApiError.parameterNotAvailable("xyz", "/lights/1/state");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.PARAMETER_NOT_AVAILABLE);
            (0, chai_1.expect)(err.message).to.equal("parameter, xyz, not available");
        });
        it("should create invalidParameterValue error", () => {
            const err = errors_1.HueApiError.invalidParameterValue("999", "bri", "/lights/1/state");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.INVALID_PARAMETER_VALUE);
            (0, chai_1.expect)(err.message).to.equal("invalid value, 999, for parameter, bri");
        });
        it("should create linkButtonNotPressed error", () => {
            const err = errors_1.HueApiError.linkButtonNotPressed("/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.LINK_BUTTON_NOT_PRESSED);
            (0, chai_1.expect)(err.message).to.equal("link button not pressed");
        });
        it("should create internalError error", () => {
            const err = errors_1.HueApiError.internalError("something broke", "/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.INTERNAL_ERROR);
            (0, chai_1.expect)(err.message).to.equal("internal error, something broke");
        });
        it("should use empty string as default address", () => {
            const err = errors_1.HueApiError.unauthorizedUser();
            (0, chai_1.expect)(err.address).to.equal("");
        });
    });
    describe("toResponse", () => {
        it("should format as Hue API error response", () => {
            const err = errors_1.HueApiError.unauthorizedUser("/api/baduser/lights");
            const response = err.toResponse();
            (0, chai_1.expect)(response).to.deep.equal({
                error: {
                    type: 1,
                    address: "/api/baduser/lights",
                    description: "unauthorized user",
                },
            });
        });
        it("should include substituted parameters in description", () => {
            const err = errors_1.HueApiError.resourceNotAvailable("99", "/lights/99");
            const response = err.toResponse();
            (0, chai_1.expect)(response.error.type).to.equal(3);
            (0, chai_1.expect)(response.error.description).to.equal("resource, 99, not available");
            (0, chai_1.expect)(response.error.address).to.equal("/lights/99");
        });
    });
    describe("error type enum values", () => {
        it("should have correct numeric values", () => {
            (0, chai_1.expect)(errors_1.HueErrorType.UNAUTHORIZED_USER).to.equal(1);
            (0, chai_1.expect)(errors_1.HueErrorType.INVALID_JSON).to.equal(2);
            (0, chai_1.expect)(errors_1.HueErrorType.RESOURCE_NOT_AVAILABLE).to.equal(3);
            (0, chai_1.expect)(errors_1.HueErrorType.METHOD_NOT_AVAILABLE).to.equal(4);
            (0, chai_1.expect)(errors_1.HueErrorType.MISSING_PARAMETERS).to.equal(5);
            (0, chai_1.expect)(errors_1.HueErrorType.PARAMETER_NOT_AVAILABLE).to.equal(6);
            (0, chai_1.expect)(errors_1.HueErrorType.INVALID_PARAMETER_VALUE).to.equal(7);
            (0, chai_1.expect)(errors_1.HueErrorType.PARAMETER_NOT_MODIFIABLE).to.equal(8);
            (0, chai_1.expect)(errors_1.HueErrorType.INTERNAL_ERROR).to.equal(901);
            (0, chai_1.expect)(errors_1.HueErrorType.LINK_BUTTON_NOT_PRESSED).to.equal(101);
            (0, chai_1.expect)(errors_1.HueErrorType.DEVICE_IS_OFF).to.equal(201);
        });
    });
});
describe("createSuccessResponse", () => {
    it("should wrap data in success array", () => {
        const response = (0, error_handler_1.createSuccessResponse)({ username: "test123" });
        (0, chai_1.expect)(response).to.deep.equal([{ success: { username: "test123" } }]);
    });
    it("should handle empty data", () => {
        const response = (0, error_handler_1.createSuccessResponse)({});
        (0, chai_1.expect)(response).to.deep.equal([{ success: {} }]);
    });
    it("should handle multiple keys", () => {
        const response = (0, error_handler_1.createSuccessResponse)({ key1: "val1", key2: 42 });
        (0, chai_1.expect)(response).to.deep.equal([{ success: { key1: "val1", key2: 42 } }]);
    });
});
//# sourceMappingURL=testErrors.js.map