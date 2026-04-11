"use strict";
/**
 * Configuration types for the Hue Emulator
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBridgeId = generateBridgeId;
exports.generateSerialNumber = generateSerialNumber;
/**
 * Generate bridge ID from MAC address
 */
function generateBridgeId(mac) {
    const cleanMac = mac.replace(/:/g, "").toUpperCase();
    // Insert FFFE in the middle (standard for Hue bridge ID format)
    return `${cleanMac.slice(0, 6)}FFFE${cleanMac.slice(6)}`;
}
/**
 * Generate serial number from MAC address
 */
function generateSerialNumber(mac) {
    return mac.replace(/:/g, "").toLowerCase();
}
//# sourceMappingURL=config.js.map