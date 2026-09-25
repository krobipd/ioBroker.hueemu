/**
 * The attributes a Hue light state (and a group action) accepts.
 *
 * Both write paths judge an incoming body by this one set: an attribute outside
 * it is answered with Hue error 6 (`parameter, <name>, not available`), exactly
 * like the bridge. v1.18.0: the single-light path used to acknowledge ANY key as
 * success while the group path silently dropped it (audit 2026-09-15 C4).
 *
 * Known attributes a particular light does not map (`ct` on a dimmer) are a
 * different matter and stay acknowledged — see `DeviceBindingService.setLightState`.
 */
export const LIGHT_STATE_KEYS: ReadonlySet<string> = new Set([
  "on",
  "bri",
  "hue",
  "sat",
  "ct",
  "xy",
  "transitiontime",
  "bri_inc",
  "sat_inc",
  "hue_inc",
  "ct_inc",
  "xy_inc",
  "effect",
  "alert",
]);

/**
 * Attributes a light state REPORTS but a client cannot set — v1.19.0 (audit 2026-09-25
 * N3). `colormode` is the result of setting xy, ct or hue/sat ("setting one of these will
 * change the colormode", Burgestrand's Hue API reference, which lists it among the
 * readable attributes only). It used to be acknowledged as written; the bridge's answer
 * for a read-only parameter is error 8.
 */
export const READ_ONLY_STATE_KEYS: ReadonlySet<string> = new Set(["colormode"]);
