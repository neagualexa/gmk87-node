#!/usr/bin/env node
/**
 * @fileoverview Preset loader for GMK87 keyboard configurations
 * Allows quick loading of predefined lighting configurations
 * Uses robust pipeline with acknowledgment checking
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { configureLighting } from "./lib/device.js";
import { FACTORY_DEFAULTS } from "./factoryDefaults.js";
import {
  loadProfiles,
  saveProfile,
  deleteProfile,
  getProfilesPath,
} from "./profiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads presets from JSON file
 * @param {string} [presetsPath] - Path to presets file
 * @returns {Object} Presets object
 */
function loadPresets(presetsPath) {
  const defaultPath = path.join(__dirname, "../presets.json");
  const filePath = presetsPath || defaultPath;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Presets file not found: ${filePath}`);
  }

  const data = fs.readFileSync(filePath, "utf8");
  return JSON.parse(data);
}

/**
 * Lists available presets
 * @param {Object} presets - Presets object
 */
function listPresets(presets) {
  console.log("\n📋 Available Presets:\n");
  const entries = Object.entries(presets.presets);

  entries.forEach(([name, preset]) => {
    console.log(`  🎨 ${name}`);
    console.log(`     ${preset.description}\n`);
  });

  console.log(`Total: ${entries.length} presets\n`);
}

/**
 * Lists saved user profiles
 */
function listProfiles() {
  const entries = Object.entries(loadProfiles());
  console.log("\n💾 Saved Profiles:\n");
  if (entries.length === 0) {
    console.log("  (none) Save one with: npm run preset -- --save <name>\n");
  }
  entries.forEach(([name, profile]) => {
    console.log(`  💾 ${name}`);
    console.log(`     ${profile.description}\n`);
  });
  console.log(`Stored in: ${getProfilesPath()}\n`);
}

/**
 * Applies a preset or saved profile configuration
 * Built-in presets are checked first, then saved profiles.
 * Uses the robust pipeline with ACK checking and retries
 * @param {string} presetName - Name of preset or profile to apply
 * @param {string} [presetsPath] - Optional custom presets file path
 * @returns {Promise<boolean>} True if preset was successfully applied
 */
async function applyPreset(presetName, presetsPath) {
  const presets = loadPresets(presetsPath);
  let preset = presets.presets[presetName];
  let kind = "preset";

  if (!preset) {
    preset = loadProfiles()[presetName];
    kind = "profile";
  }

  if (!preset) {
    throw new Error(
      `Preset or profile "${presetName}" not found. Use --list to see available presets and profiles.`
    );
  }

  console.log(`\n🎨 Applying ${kind}: ${presetName}`);
  console.log(`   ${preset.description}\n`);

  return await configureLighting(preset.config);
}

/**
 * Parses command-line arguments
 * @param {string[]} argv - Process arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.preset = arg;
      continue;
    }

    const eqIndex = arg.indexOf("=");
    let key, value;

    if (eqIndex !== -1) {
      key = arg.slice(2, eqIndex);
      value = arg.slice(eqIndex + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        i++;
      } else {
        value = true;
      }
    }

    args[key] = value;
  }
  return args;
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = parseArgs(process.argv);

  if (args.help || args.h) {
    console.log(`
GMK87 Preset Loader

Usage: node loadPreset.js [preset-name] [options]
   or: npm run preset [preset-name]

Options:
  --list, -l              List all available presets and saved profiles
  --file <path>           Use custom presets file
  --save <name>           Save the keyboard's current settings as a profile
                          (combine with a preset name to save first, then apply)
  --description <text>    Description for --save
  --delete <name>         Delete a saved profile
  --factory-reset         Reset underglow and LED to factory defaults
                          (same as holding Fn+Space; combine with --save to back up first)
  --help, -h              Show this help message

Examples:
  node loadPreset.js gaming
  node loadPreset.js --list
  node loadPreset.js party --file ./my-presets.json
  npm run preset gaming
  npm run preset -- --save my-setup
  npm run preset -- gaming --save before-gaming
  npm run preset -- my-setup
  npm run preset -- --delete my-setup
  npm run preset -- --factory-reset --save before-reset

Profiles are stored in: ${getProfilesPath()}

Note: This utility now uses robust acknowledgment checking and retry logic
      to ensure preset changes are applied consistently.
    `);
    return;
  }

  try {
    if (args.list || args.l) {
      const presets = loadPresets(args.file);
      listPresets(presets);
      listProfiles();
      return;
    }

    if (args.delete !== undefined) {
      if (args.delete === true) throw new Error("--delete requires a profile name");
      if (!deleteProfile(args.delete)) {
        throw new Error(`Profile "${args.delete}" not found`);
      }
      console.log(`\n🗑️  Deleted profile "${args.delete}"\n`);
      return;
    }

    if (args.save !== undefined) {
      if (args.save === true) throw new Error("--save requires a profile name");
      console.log("\n📥 Reading current keyboard settings...");
      const { name } = await saveProfile(args.save, {
        description: typeof args.description === "string" ? args.description : undefined,
      });
      console.log(`💾 Saved current settings as profile "${name}"`);
      if (!args.preset && !args["factory-reset"]) {
        console.log(`   Restore later with: npm run preset -- "${name}"\n`);
        return;
      }
    }

    if (args["factory-reset"]) {
      console.log("\n🏭 Restoring factory defaults (underglow and LED)...");
      const ok = await configureLighting(FACTORY_DEFAULTS);
      console.log(ok ? "\n✅ Factory defaults restored!\n" : "\n⚠️  Sent but may not have been acknowledged\n");
      if (!ok) process.exit(1);
      return;
    }

    if (!args.preset) {
      console.error("❌ Error: Preset name required");
      console.log("Usage: node loadPreset.js [preset-name]");
      console.log("       Use --list to see available presets");
      process.exit(1);
    }

    const success = await applyPreset(args.preset, args.file);
    
    if (success) {
      console.log("\n✅ Preset applied successfully!\n");
    } else {
      console.log("\n⚠️  Preset sent but may not have been acknowledged\n");
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { loadPresets, applyPreset, listPresets, listProfiles };