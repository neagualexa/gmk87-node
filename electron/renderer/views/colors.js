/**
 * Color Options view - Underglow, LED, Presets, Display
 */

const EFFECT_OPTIONS = [
  "Off",
  "Horizontal Dimming Wave",
  "Horizontal Pulse Wave",
  "Waterfall",
  "Full Cycling Colors",
  "Breathing",
  "Full One Color",
  "Glow Pressed Key",
  "Glow Spreading",
  "Glow Row",
  "Random Pattern",
  "Rainbow Cycle",
  "Rainbow Waterfall",
  "Wave from Center",
  "Circling JK",
  "Raining",
  "Wave Left-Right",
  "Slow Saturation Cycle",
  "Slow Rainbow from Center",
];

// LED (strip light) modes, cycled on the keyboard with Fn+PgUp
const LED_MODE_OPTIONS = [
  "Blinking One Color",
  "Pulse Rainbow",
  "Blinking One Color Alt",
  "Fixed Color",
  "Fixed Color Alt",
];
// The protocol calls it "saturation", but on hardware it is the strip's brightness; 0 = off
const LED_DEFAULT_BRIGHTNESS = 5;

const COLOR_NAMES = [
  "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "White", "Off",
];

const HUE_SWATCHES = [
  { name: "Red", rgb: { red: 255, green: 0, blue: 0 }, hex: "#ff0000" },
  { name: "Orange", rgb: { red: 255, green: 128, blue: 0 }, hex: "#ff8000" },
  { name: "Yellow", rgb: { red: 255, green: 255, blue: 0 }, hex: "#ffff00" },
  { name: "Green", rgb: { red: 0, green: 255, blue: 0 }, hex: "#00ff00" },
  { name: "Cyan", rgb: { red: 0, green: 255, blue: 255 }, hex: "#00ffff" },
  { name: "Blue", rgb: { red: 0, green: 0, blue: 255 }, hex: "#0000ff" },
  { name: "Purple", rgb: { red: 128, green: 0, blue: 255 }, hex: "#8000ff" },
  { name: "White", rgb: { red: 255, green: 255, blue: 255 }, hex: "#ffffff" },
];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

const ColorsView = {
  _presets: null,
  _profiles: {},
  _busy: false,
  _colorPicker: null,

  // Current form state
  _ug: { effect: 0, brightness: 5, speed: 5, orientation: 1, rainbow: 0, hue: { red: 255, green: 255, blue: 255 } },
  _led: { mode: 3, color: 0, saturation: 5, rainbow: 0 },
  _display: 0,
  // LED brightness to restore when the strip light is switched back on
  _ledOnBrightness: LED_DEFAULT_BRIGHTNESS,

  // Which preset/profile the form is based on: { kind: "preset" | "profile", name } or null
  _loaded: null,
  // Snapshot of the form when it was last loaded/saved, used to detect unsaved edits
  _baseline: null,

  async render() {
    this._busy = false;
    const content = document.getElementById("content");
    content.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Color Options</h1>
        <p class="page-subtitle">Configure underglow, LED, and display settings</p>
      </div>
      <div id="colors-body">
        <div class="empty-state">
          <div class="spinner" style="margin: 0 auto 16px;"></div>
          <p class="empty-state-desc">Loading...</p>
        </div>
      </div>
    `;

    // Load presets and current config in parallel
    const [presetsResult, configResult, profilesResult] = await Promise.all([
      window.gmk87.getPresets(),
      window.gmk87.readConfig(),
      window.gmk87.listProfiles(),
    ]);

    if (presetsResult.success) {
      this._presets = presetsResult.data;
    }
    if (profilesResult.success) {
      this._profiles = profilesResult.data;
    }

    if (configResult.success) {
      const cfg = configResult.data;
      if (cfg.underglow) {
        this._ug = { ...this._ug, ...cfg.underglow };
        if (cfg.underglow.hue) {
          this._ug.hue = { ...this._ug.hue, ...cfg.underglow.hue };
        }
      }
      if (cfg.led) {
        this._led = { ...this._led, ...cfg.led };
      }
      this._display = cfg.showImage ?? 0;
    }

    this._loaded = this._detectLoaded();
    this._baseline = this._snapshot();

    // Any form interaction may change the unsaved state (one listener; body persists across re-renders)
    const body = document.getElementById("colors-body");
    if (body) {
      const refresh = () => queueMicrotask(() => this._refreshStatus());
      body.addEventListener("input", refresh);
      body.addEventListener("change", refresh);
      body.addEventListener("click", refresh);
    }

    this._renderBody();
  },

  /** Normalized string of the given settings, for comparing configs */
  _configKey(ug = {}, led = {}, display) {
    const hue = ug.hue || {};
    return JSON.stringify([
      ug.effect, ug.brightness, ug.speed, ug.orientation, ug.rainbow ? 1 : 0,
      hue.red, hue.green, hue.blue,
      led.mode, led.saturation, led.rainbow ? 1 : 0, led.color,
      display ?? 0,
    ]);
  },

  /** Snapshot of the current form state */
  _snapshot() {
    return this._configKey(this._ug, this._led, this._display);
  },

  /** The form state as a profile config */
  _formConfig() {
    return {
      underglow: { ...this._ug, hue: { ...this._ug.hue } },
      led: { ...this._led },
      showImage: this._display,
    };
  },

  /** Finds a saved profile (then preset) matching the current form, if any */
  _detectLoaded() {
    const current = this._snapshot();
    const matches = (cfg) => cfg && this._configKey(cfg.underglow, cfg.led, cfg.showImage) === current;
    for (const [name, p] of Object.entries(this._profiles || {})) {
      if (matches(p.config)) return { kind: "profile", name };
    }
    for (const [name, p] of Object.entries(this._presets || {})) {
      if (matches(p.config)) return { kind: "preset", name };
    }
    return null;
  },

  /** True when the form has edits that are not stored in any profile */
  _hasUnsavedChanges() {
    // Settings that don't come from any preset/profile always count as unsaved
    return !this._loaded || this._snapshot() !== this._baseline;
  },

  _saveButtonLabel() {
    if (this._loaded?.kind === "profile") return `Save to "${escapeHtml(this._loaded.name)}"`;
    return "Save as New Profile";
  },

  _statusText() {
    const unsaved = this._hasUnsavedChanges();
    if (!this._loaded) return "Current settings are not saved in a profile";
    const label = `${this._loaded.kind === "preset" ? "Preset" : "Profile"} "${escapeHtml(this._loaded.name)}"`;
    return unsaved ? `${label} · <span class="unsaved">unsaved changes</span>` : label;
  },

  /** Updates the save button label and status line without re-rendering the form */
  _refreshStatus() {
    const status = document.getElementById("colors-status");
    const saveBtn = document.getElementById("colors-save");
    if (status) status.innerHTML = this._statusText();
    if (saveBtn) {
      saveBtn.innerHTML = this._saveButtonLabel();
      saveBtn.title = saveBtn.textContent;
    }
  },

  _renderBody() {
    const body = document.getElementById("colors-body");
    if (!body) return;
    this._colorPicker = null;

    body.innerHTML = `
      ${this._renderPresets()}
      ${this._renderProfiles()}
      ${this._renderUnderglow()}
      ${this._renderLed()}
      ${this._renderDisplay()}
    `;

    this._bind();
    this._renderActions();
  },

  /** Puts Apply / Save / Factory Reset into the sidebar's actions area */
  _renderActions() {
    const slot = document.getElementById("sidebar-actions");
    if (!slot) return;
    slot.innerHTML = `
      <div class="sidebar-status" id="colors-status">${this._statusText()}</div>
      <button class="btn btn-primary btn-block" id="colors-apply">Apply Changes</button>
      <button class="btn btn-block" id="colors-save" title="${this._saveButtonLabel()}">${this._saveButtonLabel()}</button>
      <button class="btn btn-block btn-danger" id="colors-reset">Factory Reset</button>
    `;
    document.getElementById("colors-apply").addEventListener("click", () => this._apply());
    document.getElementById("colors-save").addEventListener("click", () => this._saveToLoaded());
    document.getElementById("colors-reset").addEventListener("click", () => this._applyPreset("factory defaults", { isFactory: true }));
  },

  _renderPresets() {
    if (!this._presets) return "";
    const names = Object.keys(this._presets);
    return `
      <div class="card section-gap">
        <div class="card-title">Presets</div>
        <div class="pill-row">
          ${names.map((name) => `<button class="pill ${this._isLoaded("preset", name) ? "active" : ""}" data-preset="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}
        </div>
      </div>
    `;
  },

  _isLoaded(kind, name) {
    return this._loaded?.kind === kind && this._loaded.name === name;
  },

  _renderProfiles() {
    const entries = Object.entries(this._profiles || {});
    return `
      <div class="card section-gap">
        <div class="card-title-row">
          <div class="card-title">Saved Profiles</div>
          <button class="btn btn-sm" id="profile-save">Save as New</button>
        </div>
        ${entries.length === 0
          ? `<p class="profile-empty">No saved profiles yet. Save the settings below to restore them later.</p>`
          : `<div class="pill-row">
              ${entries.map(([name, p]) => `
                <span class="profile-pill">
                  <button class="pill pill-profile ${this._isLoaded("profile", name) ? "active" : ""}" data-profile="${escapeHtml(name)}" title="${escapeHtml(p.description || "")}">${escapeHtml(name)}</button>
                  <button class="profile-delete" data-profile-delete="${escapeHtml(name)}" title="Delete profile" aria-label="Delete ${escapeHtml(name)}">&times;</button>
                </span>`).join("")}
            </div>`}
      </div>
    `;
  },

  _renderUnderglow() {
    const ug = this._ug;
    // Detect if current hue matches a preset swatch
    const activeSwatchIndex = HUE_SWATCHES.findIndex(
      (s) => s.rgb.red === ug.hue.red && s.rgb.green === ug.hue.green && s.rgb.blue === ug.hue.blue
    );
    const isCustom = activeSwatchIndex === -1;
    return `
      <div class="card section-gap">
        <div class="card-title">Underglow</div>
        <div class="form-group">
          <label class="form-label">Effect</label>
          <select id="ug-effect">
            ${EFFECT_OPTIONS.map((name, i) => `<option value="${i}" ${i === ug.effect ? "selected" : ""}>${name}</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Brightness</label>
            <div class="range-wrapper">
              <input type="range" id="ug-brightness" min="0" max="9" value="${ug.brightness}">
              <span class="range-value" id="ug-brightness-val">${ug.brightness}</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Speed</label>
            <div class="range-wrapper">
              <input type="range" id="ug-speed" min="0" max="9" value="${ug.speed}">
              <span class="range-value" id="ug-speed-val">${ug.speed}</span>
            </div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <div class="switch-row">
              <span class="form-label" style="margin-bottom:0">Orientation</span>
              <label class="switch">
                <input type="checkbox" id="ug-orientation" ${ug.orientation ? "checked" : ""}>
                <span class="switch-track"></span>
              </label>
            </div>
          </div>
          <div class="form-group">
            <div class="switch-row">
              <span class="form-label" style="margin-bottom:0">Rainbow</span>
              <label class="switch">
                <input type="checkbox" id="ug-rainbow" ${ug.rainbow ? "checked" : ""}>
                <span class="switch-track"></span>
              </label>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Hue Color</label>
          <div class="color-swatches" id="ug-hue-swatches">
            ${HUE_SWATCHES.map((s, i) => `<button class="hue-swatch ${i === activeSwatchIndex ? "active" : ""}" data-hue="${i}" title="${s.name}" style="background:${s.hex}"></button>`).join("")}
            <button class="hue-swatch custom ${isCustom ? "active" : ""}" data-hue="custom" title="Custom"></button>
          </div>
          <div id="ug-hue-picker" class="${isCustom ? "" : "hidden"} ${ug.rainbow ? "dimmed" : ""}"></div>
        </div>
      </div>
    `;
  },

  _renderLed() {
    const led = this._led;
    const isOn = led.saturation > 0;
    if (isOn) this._ledOnBrightness = led.saturation;
    // Show a mode the keyboard reports even if it isn't one of the known ones
    const modes = LED_MODE_OPTIONS.map((label, value) => ({ value, label }));
    if (!modes.some((m) => m.value === led.mode)) modes.push({ value: led.mode, label: `Mode ${led.mode}` });
    return `
      <div class="card section-gap">
        <div class="card-title">LED</div>
        <div class="form-group">
          <div class="switch-row">
            <span class="form-label" style="margin-bottom:0">Strip Light</span>
            <label class="switch">
              <input type="checkbox" id="led-on" ${isOn ? "checked" : ""}>
              <span class="switch-track"></span>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Mode</label>
          <select id="led-mode">
            ${modes.map((m) => `<option value="${m.value}" ${m.value === led.mode ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-swatches">
            ${COLOR_NAMES.map((name, i) => `<button class="color-swatch ${i === led.color ? "active" : ""}" data-color="${i}" title="${name}"></button>`).join("")}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Brightness</label>
          <div class="range-wrapper">
            <input type="range" id="led-saturation" min="0" max="9" value="${led.saturation}">
            <span class="range-value" id="led-saturation-val">${led.saturation}</span>
          </div>
        </div>
        <div class="form-group">
          <div class="switch-row">
            <span class="form-label" style="margin-bottom:0">Rainbow</span>
            <label class="switch">
              <input type="checkbox" id="led-rainbow" ${led.rainbow ? "checked" : ""}>
              <span class="switch-track"></span>
            </label>
          </div>
        </div>
      </div>
    `;
  },

  _renderDisplay() {
    return `
      <div class="card section-gap">
        <div class="card-title">Display Slot</div>
        <div class="toggle-group">
          <button class="toggle-btn ${this._display === 0 ? "active" : ""}" data-display="0">Clock</button>
          <button class="toggle-btn ${this._display === 1 ? "active" : ""}" data-display="1">Slot 0</button>
          <button class="toggle-btn ${this._display === 2 ? "active" : ""}" data-display="2">Slot 1</button>
        </div>
      </div>
    `;
  },

  _bind() {
    // Presets
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => this._applyPreset(btn.dataset.preset));
    });

    // Profiles
    document.querySelectorAll("[data-profile]").forEach((btn) => {
      btn.addEventListener("click", () => this._applyPreset(btn.dataset.profile, { isProfile: true }));
    });
    document.querySelectorAll("[data-profile-delete]").forEach((btn) => {
      btn.addEventListener("click", () => this._deleteProfile(btn.dataset.profileDelete));
    });
    document.getElementById("profile-save").addEventListener("click", () => this._saveProfile());

    // Underglow
    const ugEffect = document.getElementById("ug-effect");
    const ugBrightness = document.getElementById("ug-brightness");
    const ugSpeed = document.getElementById("ug-speed");
    const ugOrientation = document.getElementById("ug-orientation");
    const ugRainbow = document.getElementById("ug-rainbow");
    const ugHueContainer = document.getElementById("ug-hue-picker");

    ugEffect.addEventListener("change", () => { this._ug.effect = parseInt(ugEffect.value); });
    ugBrightness.addEventListener("input", () => {
      this._ug.brightness = parseInt(ugBrightness.value);
      document.getElementById("ug-brightness-val").textContent = ugBrightness.value;
    });
    ugSpeed.addEventListener("input", () => {
      this._ug.speed = parseInt(ugSpeed.value);
      document.getElementById("ug-speed-val").textContent = ugSpeed.value;
    });
    ugOrientation.addEventListener("change", () => { this._ug.orientation = ugOrientation.checked ? 1 : 0; });
    ugRainbow.addEventListener("change", () => {
      this._ug.rainbow = ugRainbow.checked ? 1 : 0;
      ugHueContainer.classList.toggle("dimmed", ugRainbow.checked);
    });

    // Hue swatches
    document.querySelectorAll("#ug-hue-swatches .hue-swatch").forEach((swatch) => {
      swatch.addEventListener("click", () => {
        document.querySelectorAll("#ug-hue-swatches .hue-swatch").forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");

        if (swatch.dataset.hue === "custom") {
          ugHueContainer.classList.remove("hidden");
          this._initColorPicker();
        } else {
          ugHueContainer.classList.add("hidden");
          const idx = parseInt(swatch.dataset.hue);
          this._ug.hue = { ...HUE_SWATCHES[idx].rgb };
        }
      });
    });

    // Initialize color picker if Custom is already active
    if (document.querySelector('#ug-hue-swatches .hue-swatch.custom.active')) {
      this._initColorPicker();
    }

    // LED
    const ledMode = document.getElementById("led-mode");
    const ledSaturation = document.getElementById("led-saturation");
    const ledRainbow = document.getElementById("led-rainbow");
    const ledOn = document.getElementById("led-on");

    const setLedBrightness = (value) => {
      this._led.saturation = value;
      ledSaturation.value = value;
      document.getElementById("led-saturation-val").textContent = value;
      ledOn.checked = value > 0;
      if (value > 0) this._ledOnBrightness = value;
    };

    ledMode.addEventListener("change", () => { this._led.mode = parseInt(ledMode.value); });
    // Off = brightness 0; on = restore the last non-zero brightness
    ledOn.addEventListener("change", () => {
      setLedBrightness(ledOn.checked ? this._ledOnBrightness || LED_DEFAULT_BRIGHTNESS : 0);
    });
    ledSaturation.addEventListener("input", () => setLedBrightness(parseInt(ledSaturation.value)));
    ledRainbow.addEventListener("change", () => { this._led.rainbow = ledRainbow.checked ? 1 : 0; });

    document.querySelectorAll(".color-swatch").forEach((swatch) => {
      swatch.addEventListener("click", () => {
        document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");
        this._led.color = parseInt(swatch.dataset.color);
      });
    });

    // Display
    document.querySelectorAll("[data-display]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-display]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this._display = parseInt(btn.dataset.display);
      });
    });

    // Apply
  },

  async _applyPreset(name, { isProfile = false, isFactory = false } = {}) {
    if (this._busy) return;
    const kindLabel = isFactory ? "Factory defaults" : isProfile ? "Profile" : "Preset";

    const choice = await this._showConfirmModal(name, isProfile, isFactory);
    if (!choice) return;

    this._busy = true;
    this._setAllDisabled(true);

    // Optionally snapshot the keyboard's current settings before overwriting them
    if (choice.backupName) {
      const saveResult = await window.gmk87.saveProfile({
        name: choice.backupName,
        config: this._formConfig(),
        description: this._profiles[choice.backupName]?.description,
      });
      if (!saveResult.success) {
        this._busy = false;
        this._setAllDisabled(false);
        Toast.error(`Not applied: could not save current settings (${saveResult.error})`);
        return;
      }
      this._profiles = { ...this._profiles, [saveResult.data.name]: saveResult.data.profile };
    }

    const result = isFactory
      ? await window.gmk87.factoryReset()
      : isProfile
        ? await window.gmk87.applyProfile(name)
        : await window.gmk87.applyPreset(name);
    this._busy = false;
    this._setAllDisabled(false);

    if (result.success) {
      const saved = choice.backupName ? ` (previous settings saved as "${choice.backupName}")` : "";
      this._loaded = isFactory ? null : { kind: isProfile ? "profile" : "preset", name };
      Toast.success(isFactory
        ? `Factory defaults restored${saved}`
        : `${kindLabel} "${name}" applied${saved}`);
      // Reload config to reflect changes
      const cfgResult = await window.gmk87.readConfig();
      if (cfgResult.success) {
        const cfg = cfgResult.data;
        if (cfg.underglow) {
          this._ug = { ...this._ug, ...cfg.underglow };
          if (cfg.underglow.hue) this._ug.hue = { ...this._ug.hue, ...cfg.underglow.hue };
        }
        if (cfg.led) this._led = { ...this._led, ...cfg.led };
        this._display = cfg.showImage ?? 0;
      }
      this._baseline = this._snapshot();
      this._renderBody();
    } else {
      if (choice.backupName) this._renderBody();
      Toast.error(result.error || `Failed to apply ${kindLabel.toLowerCase()}`);
    }
  },

  /**
   * Asks the user to confirm applying a preset/profile, optionally saving current settings first.
   * @returns {Promise<false | {backupName: string | null}>}
   */
  _showConfirmModal(name, isProfile = false, isFactory = false) {
    const kind = isProfile ? "Profile" : "Preset";
    const title = isFactory ? "Factory Reset" : `Apply ${kind}`;
    const text = isFactory
      ? "This resets the underglow and LED strip light to factory defaults, the same as holding Fn+Space for 3 seconds. Continue?"
      : `This will overwrite your current settings with the "${escapeHtml(name)}" ${kind.toLowerCase()}. Continue?`;
    const loadedProfile = this._loaded?.kind === "profile" ? this._loaded.name : null;
    const defaultBackup = loadedProfile && loadedProfile !== name
      ? loadedProfile
      : `before ${name}`.slice(0, 40).replace(/[^A-Za-z0-9 _.-]/g, "-");
    const unsaved = this._hasUnsavedChanges();
    const warning = !unsaved
      ? ""
      : this._loaded
        ? `Your edits to "${escapeHtml(this._loaded.name)}" are not saved and will be lost.`
        : "Your current settings are not saved in a profile and will be lost.";

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-title">${title}</div>
          <div class="modal-text">${text}</div>
          ${warning ? `<div class="modal-warning" id="modal-warning">&#9888; ${warning}</div>` : ""}
          <label class="modal-check">
            <input type="checkbox" id="modal-backup">
            <span>Save current settings as a profile first</span>
          </label>
          <input type="text" class="text-input hidden" id="modal-backup-name" maxlength="40" value="${escapeHtml(defaultBackup)}" placeholder="Profile name">
          <div class="modal-error" id="modal-error"></div>
          <div class="modal-actions">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn ${isFactory ? "btn-danger" : "btn-primary"}" id="modal-apply">${isFactory ? "Reset" : "Apply"}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const backupCheck = overlay.querySelector("#modal-backup");
      const backupName = overlay.querySelector("#modal-backup-name");
      const warningEl = overlay.querySelector("#modal-warning");
      const errorEl = overlay.querySelector("#modal-error");

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      backupCheck.addEventListener("change", () => {
        backupName.classList.toggle("hidden", !backupCheck.checked);
        if (warningEl) warningEl.classList.toggle("hidden", backupCheck.checked);
        errorEl.textContent = "";
        if (backupCheck.checked) backupName.focus();
      });

      overlay.querySelector("#modal-cancel").addEventListener("click", () => close(false));
      overlay.querySelector("#modal-apply").addEventListener("click", async () => {
        if (!backupCheck.checked) return close({ backupName: null });
        const n = backupName.value.trim();
        const err = this._validateProfileName(n);
        if (err) {
          errorEl.textContent = err;
          return;
        }
        if (n === name && isProfile) {
          errorEl.textContent = "Choose a different name than the profile being applied";
          return;
        }
        if (this._profiles[n] && n !== loadedProfile &&
            !(await this._confirm("Overwrite Profile", `A profile named "${n}" already exists. Overwrite it?`, "Overwrite"))) {
          return;
        }
        close({ backupName: n });
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(false);
      });
    });
  },

  _validateProfileName(name) {
    if (!name) return "Enter a profile name";
    if (name.length > 40) return "Name must be at most 40 characters";
    if (!/^[A-Za-z0-9 _.-]+$/.test(name)) return "Use only letters, numbers, spaces, - _ .";
    if (this._presets && Object.keys(this._presets).some((p) => p.toLowerCase() === name.toLowerCase())) {
      return "That name is used by a built-in preset";
    }
    return null;
  },

  /** Prompts for a name, returns it or null if cancelled */
  _promptProfileName(defaultName = "") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-title">Save Profile</div>
          <div class="modal-text">Saves the settings currently shown on this page (underglow, LED and display slot).</div>
          <input type="text" class="text-input" id="modal-profile-name" maxlength="40" placeholder="Profile name" value="${escapeHtml(defaultName)}">
          <div class="modal-error" id="modal-error"></div>
          <div class="modal-actions">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-save">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const input = overlay.querySelector("#modal-profile-name");
      const errorEl = overlay.querySelector("#modal-error");
      input.focus();
      input.select();

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };
      const submit = async () => {
        const n = input.value.trim();
        const err = this._validateProfileName(n);
        if (err) {
          errorEl.textContent = err;
          return;
        }
        if (this._profiles[n] && !(await this._confirm("Overwrite Profile", `A profile named "${n}" already exists. Overwrite it?`, "Overwrite"))) {
          return;
        }
        close(n);
      };

      overlay.querySelector("#modal-cancel").addEventListener("click", () => close(null));
      overlay.querySelector("#modal-save").addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") close(null);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(null);
      });
    });
  },

  _confirm(title, text, okLabel = "OK") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="modal-text">${escapeHtml(text)}</div>
          <div class="modal-actions">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-ok">${escapeHtml(okLabel)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const close = (result) => {
        overlay.remove();
        resolve(result);
      };
      overlay.querySelector("#modal-cancel").addEventListener("click", () => close(false));
      overlay.querySelector("#modal-ok").addEventListener("click", () => close(true));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close(false);
      });
    });
  },

  /** "Save as New" in the profiles card: always prompts for a new name */
  async _saveProfile(defaultName = "") {
    if (this._busy) return;
    const name = await this._promptProfileName(defaultName);
    if (!name) return;
    await this._writeProfile(name);
  },

  /**
   * Bottom "Save" button: saves edits into the loaded profile.
   * If a preset (or nothing) is loaded, creates a new profile from the current form instead.
   */
  async _saveToLoaded() {
    if (this._busy) return;
    if (this._loaded?.kind === "profile") {
      if (!this._hasUnsavedChanges()) {
        Toast.success(`No changes to save in "${this._loaded.name}"`);
        return;
      }
      await this._writeProfile(this._loaded.name);
      return;
    }
    const suggestion = this._loaded?.kind === "preset"
      ? `${this._loaded.name} custom`.slice(0, 40)
      : "";
    await this._saveProfile(suggestion);
  },

  async _writeProfile(name) {
    const result = await window.gmk87.saveProfile({
      name,
      config: this._formConfig(),
      description: this._profiles[name]?.description,
    });

    if (result.success) {
      this._profiles = { ...this._profiles, [result.data.name]: result.data.profile };
      this._loaded = { kind: "profile", name: result.data.name };
      this._baseline = this._snapshot();
      this._renderBody();
      Toast.success(`Profile "${result.data.name}" saved`);
    } else {
      Toast.error(result.error || "Failed to save profile");
    }
  },

  async _deleteProfile(name) {
    if (this._busy) return;
    if (!(await this._confirm("Delete Profile", `Delete the saved profile "${name}"?`, "Delete"))) return;

    const result = await window.gmk87.deleteProfile(name);
    if (result.success) {
      const { [name]: _removed, ...rest } = this._profiles;
      this._profiles = rest;
      if (this._isLoaded("profile", name)) this._loaded = null;
      this._renderBody();
      Toast.success(`Profile "${name}" deleted`);
    } else {
      Toast.error(result.error || "Failed to delete profile");
    }
  },

  async _apply() {
    if (this._busy) return;
    this._busy = true;

    const btn = document.getElementById("colors-apply");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Applying...`;
    this._setAllDisabled(true);

    const result = await window.gmk87.setLighting({
      underglow: { ...this._ug },
      led: { ...this._led },
      showImage: this._display,
    });

    this._busy = false;
    btn.disabled = false;
    btn.innerHTML = "Apply Changes";
    this._setAllDisabled(false);

    if (result.success) {
      Toast.success("Lighting applied");
    } else {
      Toast.error(result.error || "Failed to apply lighting");
    }
  },

  _setAllDisabled(disabled) {
    const body = document.getElementById("colors-body");
    if (!body) return;
    body.querySelectorAll("button, select, input").forEach((el) => {
      el.disabled = disabled;
    });
    // Apply manages its own state (spinner); Save and Factory Reset live in the sidebar
    ["colors-save", "colors-reset"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  },

  _initColorPicker() {
    if (this._colorPicker) return;
    const hueHex = this._rgbToHex(this._ug.hue.red, this._ug.hue.green, this._ug.hue.blue);
    this._colorPicker = new iro.ColorPicker("#ug-hue-picker", {
      width: 160,
      color: hueHex,
      borderWidth: 2,
      borderColor: "#333333",
      handleRadius: 8,
      layoutDirection: "horizontal",
      layout: [
        { component: iro.ui.Wheel, options: {} },
      ],
    });
    this._colorPicker.on("color:change", (color) => {
      this._ug.hue = { red: color.rgb.r, green: color.rgb.g, blue: color.rgb.b };
      this._refreshStatus();
    });
  },

  _rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
  },

};
