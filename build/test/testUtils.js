"use strict";
/**
 * Tests for shared utility functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const utils_1 = require("../src/types/utils");
describe("sanitizeId", () => {
    it("should pass through alphanumeric strings unchanged", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("abc123")).to.equal("abc123");
    });
    it("should pass through hyphens and underscores", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("my-device_01")).to.equal("my-device_01");
    });
    it("should replace dots with underscore", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("alexa.device.1")).to.equal("alexa_device_1");
    });
    it("should replace spaces with underscore", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("my device")).to.equal("my_device");
    });
    it("should replace special characters with underscore", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("user@host:1234")).to.equal("user_host_1234");
    });
    it("should handle Alexa-style UUIDs", () => {
        // Alexa sends usernames like "2WLEDHardworworworworworwo#Srehto"
        (0, chai_1.expect)((0, utils_1.sanitizeId)("2WLEDHardworworworworworwo#Srehto")).to.equal("2WLEDHardworworworworworwo_Srehto");
    });
    it("should handle empty string", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("")).to.equal("");
    });
    it("should replace multiple consecutive special chars", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("a..b//c")).to.equal("a__b__c");
    });
    it("should handle Harmony Hub style identifiers", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("harmony-hub-192.168.1.50")).to.equal("harmony-hub-192_168_1_50");
    });
    it("should preserve uppercase and lowercase", () => {
        (0, chai_1.expect)((0, utils_1.sanitizeId)("MyDevice")).to.equal("MyDevice");
    });
});
//# sourceMappingURL=testUtils.js.map