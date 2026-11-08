/**
 * @fileoverview User profiles for GMK87 lighting settings
 *
 * Profiles work like presets but are saved by the user. They live in a JSON
 * file in the user's config directory, so the CLI and the desktop app share them:
 *   - Windows:     %APPDATA%\gmk87\profiles.json
 *   - macOS/Linux: $XDG_CONFIG_HOME/gmk87/profiles.json (default ~/.config/gmk87)
 * Override with the GMK87_PROFILES environment variable.
 *
 * File format matches presets.json:
 *   { "profiles": { "<name>": { "description", "savedAt", "config": {...} } } }
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openDevice, safeClose, readConfigFromDevice, parseConfigBuffer } from "./lib/device.js";

const MAX_NAME_LENGTH = 40;
const NAME_PATTERN = /^[A-Za-z0-9 _.-]+$/;
const PRESETS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../presets.json");

/** Built-in preset names, which profiles may not reuse */
function builtInPresetNames() {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(PRESETS_PATH, "utf8")).presets || {});
  } catch {
    return [];
  }
}

/**
 * Returns the path of the profiles file
 * @returns {string}
 */
function getProfilesPath() {
  if (process.env.GMK87_PROFILES) return process.env.GMK87_PROFILES;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "gmk87", "profiles.json");
}

/**
 * Loads all saved profiles
 * @param {string} [filePath] - Optional custom profiles file
 * @returns {Object<string, {description: string, savedAt: string, config: Object}>}
 */
function loadProfiles(filePath = getProfilesPath()) {
  if (!fs.existsSync(filePath)) return {};
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return data.profiles || {};
}

function writeProfiles(profiles, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ profiles }, null, 2));
  fs.renameSync(tmp, filePath);
}

/**
 * Validates a profile name, throwing on invalid input
 * @param {string} name
 * @returns {string} Trimmed name
 */
function validateProfileName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new Error("Profile name is required");
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Profile name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error("Profile name may only contain letters, numbers, spaces, '-', '_' and '.'");
  }
  if (builtInPresetNames().some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`"${trimmed}" is a built-in preset name; choose another name`);
  }
  return trimmed;
}

/**
 * Keeps only the settings a profile restores (drops time, frame counts, raw bytes)
 * @param {Object} config - Full or partial config
 * @returns {Object}
 */
function pickLightingConfig(config) {
  const out = {};
  if (config.underglow) {
    const { effect, brightness, speed, orientation, rainbow, hue } = config.underglow;
    out.underglow = { effect, brightness, speed, orientation, rainbow };
    if (hue) out.underglow.hue = { red: hue.red, green: hue.green, blue: hue.blue };
  }
  if (config.led) {
    const { mode, saturation, rainbow, color } = config.led;
    out.led = { mode, saturation, rainbow, color };
  }
  if (config.winlock !== undefined) out.winlock = config.winlock;
  if (config.showImage !== undefined) out.showImage = config.showImage;
  return out;
}

/**
 * Reads the keyboard's current lighting settings
 * @returns {Promise<Object>} Config suitable for saving as a profile
 */
async function readCurrentLighting() {
  const device = openDevice();
  try {
    return pickLightingConfig(parseConfigBuffer(await readConfigFromDevice(device)));
  } finally {
    await safeClose(device);
  }
}

/**
 * Saves a profile. If no config is given, the keyboard's current settings are read.
 * Overwrites an existing profile with the same name.
 * @param {string} name - Profile name
 * @param {Object} [options]
 * @param {Object} [options.config] - Settings to save (defaults to current keyboard settings)
 * @param {string} [options.description] - Optional description
 * @param {string} [options.filePath] - Optional custom profiles file
 * @returns {Promise<{name: string, profile: Object}>}
 */
async function saveProfile(name, { config, description, filePath = getProfilesPath() } = {}) {
  const profileName = validateProfileName(name);
  const settings = pickLightingConfig(config || (await readCurrentLighting()));
  const profiles = loadProfiles(filePath);
  const profile = {
    description: description || `Saved ${new Date().toLocaleString()}`,
    savedAt: new Date().toISOString(),
    config: settings,
  };
  profiles[profileName] = profile;
  writeProfiles(profiles, filePath);
  return { name: profileName, profile };
}

/**
 * Deletes a profile
 * @param {string} name
 * @param {string} [filePath]
 * @returns {boolean} True if a profile was removed
 */
function deleteProfile(name, filePath = getProfilesPath()) {
  const profiles = loadProfiles(filePath);
  if (!(name in profiles)) return false;
  delete profiles[name];
  writeProfiles(profiles, filePath);
  return true;
}

/**
 * Returns a single profile, or undefined
 * @param {string} name
 * @param {string} [filePath]
 */
function getProfile(name, filePath = getProfilesPath()) {
  return loadProfiles(filePath)[name];
}

export {
  getProfilesPath,
  loadProfiles,
  saveProfile,
  deleteProfile,
  getProfile,
  readCurrentLighting,
  pickLightingConfig,
  validateProfileName,
};
