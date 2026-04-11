"use strict";
/**
 * Shared utility functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeId = sanitizeId;
/**
 * Sanitize a string for use as ioBroker object ID segment.
 * Replaces everything except [A-Za-z0-9-_] with underscore.
 * See: adapter.FORBIDDEN_CHARS, ioBroker object ID requirements.
 */
function sanitizeId(id) {
    return id.replace(/[^A-Za-z0-9\-_]/g, "_");
}
//# sourceMappingURL=utils.js.map