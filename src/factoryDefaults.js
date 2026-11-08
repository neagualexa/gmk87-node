/**
 * @fileoverview Factory default settings for the GMK87
 *
 * Captured from a real keyboard right after the hardware reset (hold Fn+Space for 3 seconds).
 * The keyboard stores "rainbow on" as 0xff, so these use 255 rather than 1.
 * Win-lock and the display slot are left alone: they were already 0 before the
 * reset, so it is not known whether the hardware reset changes them.
 */

export const FACTORY_DEFAULTS = {
  underglow: {
    effect: 1, // Horizontal Dimming Wave
    brightness: 9,
    speed: 2,
    orientation: 0,
    rainbow: 255,
    hue: { red: 255, green: 255, blue: 255 },
  },
  led: {
    mode: 0, // Blinking One Color
    saturation: 9, // strip brightness
    rainbow: 255,
    color: 0, // Red
  },
};
