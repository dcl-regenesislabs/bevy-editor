// Injected stylesheet — "precision instrument" editor chrome on the
// decentraland-ui2 dark palette. The system: layered glass surfaces with a lit
// top edge and deep soft shadows; ONE accent (ruby) used as a live edge, never
// as decoration; Inter for prose, monospace for everything numeric or
// structural (ids, section labels, fields) so the tool reads like an
// instrument panel. 4px grid, 28px rows, 6px control radius, 12px panels.
export const CSS = `
.eui-root, .eui-root * { box-sizing: border-box; }
.eui-root button, .eui-root input, .eui-root select, .eui-root textarea {
  text-transform: none; letter-spacing: normal;
}
.eui-root {
  position: fixed; inset: 0; z-index: 50; pointer-events: none;
  font-family: 'Inter', Helvetica, Arial, sans-serif;
  font-size: 13px; line-height: 1.4; color: var(--text);
  -webkit-font-smoothing: antialiased;

  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;

  --paper: #1D1C20;
  --paper-hi: #242328;
  --input: #141317;
  --divider: rgba(255, 255, 255, 0.10);
  --divider-soft: rgba(255, 255, 255, 0.06);
  --text: rgba(240, 240, 240, 0.96);
  --text-2: rgba(240, 240, 240, 0.66);
  --text-3: rgba(240, 240, 240, 0.38);
  --hover: rgba(240, 240, 240, 0.07);
  /* violet accent (red reads as destructive — bad for a primary CTA) */
  --primary: #8C5BF6;
  --primary-dark: #7A45E6;
  --primary-selected: rgba(140, 91, 246, 0.16);
  --primary-border: rgba(140, 91, 246, 0.6);
  --primary-glow: rgba(140, 91, 246, 0.4);
  --error: #FB3B3B;
  --error-hover: rgba(251, 59, 59, 0.14);
  --success: #34CE77;

  --surface: linear-gradient(180deg, var(--paper-hi) 0%, var(--paper) 72px);
  --shadow-panel:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    0 0 0 1px rgba(0, 0, 0, 0.4),
    0 16px 40px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-float:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 1px rgba(0, 0, 0, 0.4),
    0 12px 32px rgba(0, 0, 0, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.35);
}
.eui-root ::-webkit-scrollbar { width: 6px; height: 6px; }
.eui-root ::-webkit-scrollbar-track { background: transparent; }
.eui-root ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
.eui-root ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
.eui-root * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }

@keyframes eui-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes eui-drop { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes eui-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes eui-toast { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

/* ---------- surfaces ---------- */
.eui-panel {
  pointer-events: auto;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: 12px;
  box-shadow: var(--shadow-panel);
  display: flex; flex-direction: column; overflow: hidden;
}
.eui-left  { position: absolute; top: 12px; left: 12px; bottom: 12px; width: 264px; animation: eui-rise 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) backwards; }
.eui-right { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 320px; animation: eui-rise 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) 0.05s backwards; }

.eui-panel-head {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  height: 52px; padding: 0 10px 0 14px; flex: none;
  border-bottom: 1px solid var(--divider);
}
/* the ruby live edge: a hairline that bleeds out of the header */
.eui-panel-head::after {
  content: ''; position: absolute; left: 14px; bottom: -1px; height: 1px; width: 56px;
  background: linear-gradient(90deg, var(--primary), transparent);
}
.eui-head-text { display: flex; flex-direction: column; justify-content: center; gap: 1px; flex: 1; min-width: 0; }
.eui-overline {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-3);
}
.eui-title {
  font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.eui-title.dim { color: var(--text-3); font-weight: 400; }
.eui-panel-head .spacer { flex: 1; }
.eui-panel-body { flex: 1; overflow-y: auto; overflow-x: hidden; }

/* ---------- controls ---------- */
.eui-btn {
  pointer-events: auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; padding: 0 10px; border-radius: 7px;
  background: transparent; border: none; color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
  transition: background 0.12s, color 0.12s, box-shadow 0.12s;
}
.eui-btn:hover { background: var(--hover); }
.eui-btn.active { background: var(--primary-selected); }
.eui-btn.primary {
  background: linear-gradient(180deg, var(--primary), var(--primary-dark));
  color: #fff; font-weight: 600; padding: 0 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 1px 4px rgba(0, 0, 0, 0.4);
}
.eui-btn.primary:hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 2px 12px var(--primary-glow); filter: brightness(1.06); }
.eui-btn:disabled { opacity: 0.38; cursor: default; }
.eui-btn:disabled:hover { background: transparent; box-shadow: none; filter: none; }
.eui-btn.primary:disabled { box-shadow: none; }
.eui-btn.icon { width: 28px; padding: 0; color: var(--text-2); }
.eui-btn.icon:hover { color: var(--text); }
.eui-btn.icon.active {
  color: var(--primary); background: var(--primary-selected);
  box-shadow: inset 0 0 0 1px rgba(255, 45, 85, 0.25);
}
.eui-btn svg { width: 15px; height: 15px; flex: none; }

.eui-input {
  width: 100%; height: 28px; padding: 0 9px; border-radius: 7px;
  background: var(--input); border: 1px solid var(--divider-soft);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
  color: var(--text); font: inherit; font-size: 13px; outline: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.eui-input:focus { border-color: var(--primary-border); box-shadow: inset 0 1px 2px rgba(0,0,0,0.35), 0 0 0 2px rgba(255, 45, 85, 0.18); }
.eui-input::placeholder { color: var(--text-3); }

.eui-num {
  width: 100%; min-width: 0; height: 26px; padding: 0 7px; border-radius: 6px;
  background: var(--input); border: 1px solid var(--divider-soft);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
  color: var(--text); font-family: var(--font-mono); font-size: 11px; outline: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.eui-num:focus { border-color: var(--primary-border); box-shadow: inset 0 1px 2px rgba(0,0,0,0.3), 0 0 0 2px rgba(255, 45, 85, 0.16); }
.eui-num.dirty { border-color: var(--primary-border); }

.eui-select {
  width: 100%; height: 26px; padding: 0 6px; border-radius: 6px;
  background: var(--input); border: 1px solid var(--divider-soft);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
  color: var(--text); font: inherit; font-size: 11px; outline: none; cursor: pointer;
}
.eui-select:focus { border-color: var(--primary-border); }

.eui-toggle {
  position: relative; width: 28px; height: 16px; border-radius: 999px; flex: none;
  background: var(--input); border: 1px solid var(--divider); cursor: pointer;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: background 0.18s, border-color 0.18s;
}
.eui-toggle::after {
  content: ''; position: absolute; top: 1.5px; left: 2px; width: 11px; height: 11px;
  border-radius: 999px; background: var(--text-2);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: left 0.18s cubic-bezier(0.3, 1.4, 0.5, 1), background 0.18s;
}
.eui-toggle.on { background: var(--primary); border-color: var(--primary); box-shadow: inset 0 1px 1px rgba(0,0,0,0.2); }
.eui-toggle.on::after { left: 13px; background: #fff; }

.eui-color-swatch {
  width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--divider);
  padding: 0; cursor: pointer; flex: none; background: none;
}
.eui-color-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
.eui-color-swatch::-webkit-color-swatch { border: none; border-radius: 4px; }

.eui-raw {
  width: 100%; min-height: 72px; resize: vertical; border-radius: 7px;
  background: var(--input); border: 1px solid var(--divider-soft);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
  color: var(--text-2); font-family: var(--font-mono);
  font-size: 11px; padding: 8px; outline: none;
}
.eui-raw:focus { border-color: var(--primary-border); }
.eui-link {
  background: none; border: none; padding: 0; color: var(--text-3);
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase; cursor: pointer;
}
.eui-link:hover { color: var(--text); }

/* ---------- toolbar ---------- */
.eui-toolbar {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 40; /* always above the docks/canvas */
  overflow: visible; /* the ⋯ dropdown must escape the panel's clip */
  flex-direction: row; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 14px;
  background: rgba(29, 28, 32, 0.88);
  backdrop-filter: blur(20px) saturate(1.3); -webkit-backdrop-filter: blur(20px) saturate(1.3);
  box-shadow: var(--shadow-float);
  animation: eui-drop 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) 0.1s backwards;
}
/* recessed segmented wells for the tool / transport clusters */
.eui-tool-group {
  display: flex; align-items: center; gap: 2px;
  background: var(--input); border-radius: 9px; padding: 2px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4), inset 0 0 0 1px var(--divider-soft);
}
.eui-tool-group .eui-btn.icon { width: 30px; height: 26px; border-radius: 7px; }
.eui-tool-group .eui-btn.icon.active {
  background: linear-gradient(180deg, rgba(255, 45, 85, 0.24), rgba(255, 45, 85, 0.14));
  color: #ff8da6;
  box-shadow: inset 0 0 0 1px rgba(255, 45, 85, 0.35), 0 1px 3px rgba(0, 0, 0, 0.35);
}
.eui-toolbar > .eui-btn.icon.closed { color: var(--text-3); }
.eui-toolbar > .eui-btn.primary { height: 30px; border-radius: 9px; font-size: 12.5px; }

/* auto-save status chip (replaces the Save button when the data-layer is up) */
.eui-autosave {
  display: inline-flex; align-items: center; gap: 6px; height: 28px;
  padding: 0 12px; border-radius: 7px;
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-2);
  background: var(--input); box-shadow: inset 0 0 0 1px var(--divider-soft);
  white-space: nowrap;
}
.eui-autosave .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--text-3); flex: none; }
.eui-autosave.ok .dot { background: var(--success); }
.eui-autosave.dim .dot { background: hsl(38, 90%, 55%); }
.eui-autosave.err { color: var(--error); }
.eui-autosave.err .dot { background: var(--error); }

/* ---------- menus (toolbar overflow + context) ---------- */
.eui-menu {
  position: absolute; top: calc(100% + 8px); right: 0; min-width: 224px;
  background: var(--surface); border: 1px solid var(--divider);
  border-radius: 12px; padding: 5px; z-index: 70;
  box-shadow: var(--shadow-float);
  animation: eui-pop 0.14s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  transform-origin: top right;
}
.eui-ctx {
  position: fixed; min-width: 208px; z-index: 90; pointer-events: auto;
  background: var(--surface); border: 1px solid var(--divider);
  border-radius: 12px; padding: 5px;
  box-shadow: var(--shadow-float);
  animation: eui-pop 0.12s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  transform-origin: top left;
}
.eui-menu-item {
  display: flex; align-items: center; gap: 9px; width: 100%; height: 30px;
  padding: 0 9px; border-radius: 7px; border: none; background: none;
  color: var(--text); font: inherit; font-size: 12.5px; cursor: pointer; text-align: left;
}
.eui-menu-item:hover { background: var(--hover); }
.eui-menu-item.danger { color: var(--error); }
.eui-menu-item.danger:hover { background: var(--error-hover); }
.eui-menu-item .hint { margin-left: auto; color: var(--text-3); font-family: var(--font-mono); font-size: 10px; }
.eui-menu-item svg { width: 14px; height: 14px; flex: none; color: var(--text-2); }
.eui-menu-item.danger svg { color: var(--error); }
.eui-menu-label {
  height: 26px; display: flex; align-items: flex-end; padding: 0 9px 5px;
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-3);
}
.eui-menu-sep { height: 1px; background: var(--divider-soft); margin: 5px 9px; }

/* ---------- hierarchy ---------- */
.eui-search { padding: 10px 12px; border-bottom: 1px solid var(--divider-soft); flex: none; }

.eui-row {
  position: relative;
  display: flex; align-items: center; height: 28px; padding: 0 8px 0 4px;
  cursor: pointer; user-select: none; border-radius: 7px; margin: 0 8px;
  transition: background 0.1s;
}
.eui-row:hover { background: var(--hover); }
.eui-row.selected { background: var(--primary-selected); box-shadow: inset 2px 0 0 var(--primary); }
.eui-row.drop-into { background: var(--primary-selected); box-shadow: inset 0 0 0 1px var(--primary); }
.eui-row[draggable='true'] { cursor: grab; }
.eui-panel-body.drop-root { box-shadow: inset 0 0 0 2px var(--primary); border-radius: 7px; }
.eui-row .twisty {
  width: 18px; height: 18px; flex: none; display: flex; align-items: center; justify-content: center;
  color: var(--text-3); font-size: 8px; border-radius: 4px;
}
.eui-row .twisty:hover { background: var(--hover); color: var(--text); }
.eui-row .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-row .label .dim { color: var(--text-3); margin-left: 6px; font-family: var(--font-mono); font-size: 10px; }
.eui-row .rename {
  flex: 1; min-width: 0; height: 22px; padding: 0 6px; border-radius: 5px;
  background: var(--input); border: 1px solid var(--primary-border);
  box-shadow: 0 0 0 2px rgba(255, 45, 85, 0.16);
  color: var(--text); font: inherit; font-size: 13px; outline: none;
}
.eui-empty {
  color: var(--text-3); padding: 24px 16px; text-align: center;
  font-size: 12px; line-height: 1.6;
}

/* ---------- inspector ---------- */
.eui-name-input {
  width: 100%; min-width: 0; height: 24px; padding: 0 6px; margin-left: -6px; border-radius: 6px;
  background: transparent; border: 1px solid transparent;
  color: var(--text); font: inherit; font-size: 13px; font-weight: 600; outline: none;
  transition: background 0.12s, border-color 0.12s;
}
.eui-name-input:hover { background: var(--input); }
.eui-name-input:focus { background: var(--input); border-color: var(--primary-border); }
.eui-id-badge {
  flex: none; padding: 2px 7px; border-radius: 999px;
  font-family: var(--font-mono); font-size: 10px;
  background: var(--input); color: var(--text-2);
  box-shadow: inset 0 0 0 1px var(--divider-soft);
}

.eui-comp { border-bottom: 1px solid var(--divider-soft); }
.eui-comp:last-child { border-bottom: none; }
.eui-comp-head {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px;
  cursor: pointer; user-select: none; transition: background 0.1s;
}
.eui-comp-head:hover { background: var(--hover); }
.eui-comp-head .name { font-weight: 600; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-comp-head .name .ns { color: var(--text-3); font-weight: 400; }
.eui-comp-head .spacer { flex: 1; }
.eui-comp-head .twisty { width: 14px; color: var(--text-3); font-size: 8px; text-align: center; flex: none; }
.eui-comp-head.readonly .name { color: var(--text-2); font-weight: 400; }
.eui-comp-body { padding: 4px 12px 12px; display: flex; flex-direction: column; gap: 4px; }
.eui-comp-status { font-family: var(--font-mono); font-size: 10px; padding: 2px 0; }
.eui-comp-status.ok { color: var(--success); }
.eui-comp-status.err { color: var(--error); }

/* property rows */
.eui-prop { display: flex; align-items: center; min-height: 28px; gap: 8px; }
.eui-prop > .plabel {
  flex: none; width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text-2); font-size: 11px;
}
.eui-prop > .pvalue { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
.eui-group {
  padding-left: 9px; border-left: 1px solid var(--divider-soft);
  margin: 2px 0 4px; display: flex; flex-direction: column; gap: 2px;
}
.eui-group-label {
  font-family: var(--font-mono); font-size: 9px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-3);
  margin: 8px 0 2px;
}
.eui-axis { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.eui-axis .ax {
  flex: none; width: 11px; text-align: center;
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  color: var(--text-3); cursor: ew-resize; user-select: none;
}
.eui-axis .ax:hover { color: var(--primary); }

/* add-component popover */
.eui-pop { padding: 10px 12px; border-bottom: 1px solid var(--divider-soft); display: flex; flex-direction: column; gap: 8px; }
.eui-pop-list { max-height: 220px; overflow-y: auto; }
.eui-pop-item { height: 28px; display: flex; align-items: center; padding: 0 9px; border-radius: 7px; cursor: pointer; font-size: 12.5px; }
.eui-pop-item:hover { background: var(--hover); }
.eui-pop-item .hint { color: var(--text-3); font-family: var(--font-mono); font-size: 10px; margin-left: 8px; }

/* ---------- modals / toast ---------- */
.eui-modal-backdrop {
  position: fixed; inset: 0; background: rgba(10, 9, 12, 0.6); pointer-events: auto;
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 80;
}
.eui-modal {
  background: var(--surface); border: 1px solid var(--divider); border-radius: 14px;
  min-width: 380px; max-width: 680px; max-height: 78vh; display: flex; flex-direction: column;
  box-shadow: var(--shadow-float);
  animation: eui-pop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.eui-modal-head { padding: 16px 18px 8px; font-weight: 600; font-size: 14px; }
.eui-modal-body { padding: 8px 18px 16px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 10px; }
.eui-modal-foot {
  padding: 12px 18px; border-top: 1px solid var(--divider-soft);
  display: flex; gap: 8px; justify-content: flex-end; align-items: center;
}

/* play-mode tint: a framed border + badge while the scene is running, so it's
   obvious edits are runtime-only (Unity's playmode-tint idea) */
.eui-play-frame {
  position: fixed; inset: 0; z-index: 1; pointer-events: none;
  border: 2.5px solid hsl(38, 95%, 55%);
  box-shadow: inset 0 0 22px hsla(38, 95%, 55%, 0.35);
  animation: eui-play-pulse 2.4s ease-in-out infinite;
}
@keyframes eui-play-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
.eui-play-badge {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  padding: 4px 12px; border-radius: 999px; white-space: nowrap;
  background: hsl(38, 95%, 55%); color: #1a1400;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em;
  box-shadow: var(--shadow-float);
}

.eui-check {
  display: flex; align-items: center; gap: 8px;
  margin-top: 14px; font-size: 12.5px; color: var(--text-2); cursor: pointer; user-select: none;
}
.eui-check input { cursor: pointer; }

/* keyboard-shortcuts cheatsheet (the ? overlay) */
.eui-shortcuts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
.eui-shortcuts-group { break-inside: avoid; }
.eui-shortcuts-head {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-3); margin: 10px 0 4px;
}
.eui-shortcut-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 3px 0; font-size: 12.5px; color: var(--text-2);
}
.eui-kbd {
  font: 11px/1 ui-monospace, monospace; color: var(--text); background: var(--input);
  border: 1px solid var(--divider); border-bottom-width: 2px; border-radius: 5px;
  padding: 3px 6px; white-space: nowrap;
}
.eui-shortcuts-foot {
  margin-top: 14px; font-size: 12px; color: var(--text-3);
  display: flex; align-items: center; gap: 6px;
}

.eui-toast {
  position: absolute; bottom: 18px; left: 50%;
  pointer-events: auto; height: 38px; display: flex; align-items: center; gap: 8px;
  padding: 0 16px; border-radius: 10px;
  background: rgba(29, 28, 32, 0.92);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--divider);
  box-shadow: var(--shadow-float), inset 2px 0 0 var(--primary);
  color: var(--text); font-size: 12.5px; max-width: 60vw;
  animation: eui-toast 0.22s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
.eui-boot {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  pointer-events: none; height: 38px; display: flex; align-items: center; gap: 10px;
  padding: 0 16px; border-radius: 10px;
  background: rgba(29, 28, 32, 0.92); border: 1px solid var(--divider);
  box-shadow: var(--shadow-float);
  color: var(--text-2); font-size: 12.5px;
}
.eui-boot::before {
  content: ''; width: 10px; height: 10px; border-radius: 999px; flex: none;
  border: 2px solid var(--divider); border-top-color: var(--primary);
  animation: eui-spin 0.8s linear infinite;
}
@keyframes eui-spin { to { transform: rotate(360deg); } }

/* asset grid — adaptive: ~3 cards at the default sidebar width, more as it widens */
.eui-asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; padding: 2px 12px 12px; }
.eui-asset-count {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-3); padding: 4px 12px 6px;
}
.eui-asset-sentinel { grid-column: 1 / -1; height: 8px; }
.eui-asset {
  border: 1px solid var(--divider-soft); border-radius: 10px; padding: 6px; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px; align-items: center; text-align: center;
  background: var(--input); min-width: 0; overflow: hidden;
  transition: border-color 0.12s, transform 0.12s, box-shadow 0.12s;
}
.eui-asset:hover { border-color: var(--primary-border); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.28); }
.eui-asset img, .eui-asset .glyph { width: 100%; height: auto; aspect-ratio: 1 / 1; max-height: 74px; object-fit: contain; border-radius: 7px; }
.eui-asset .name {
  font-size: 11px; line-height: 1.25; width: 100%; color: var(--text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.eui-asset .pack { font-family: var(--font-mono); font-size: 9px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

/* draggable right edge of the left dock (resizes Hierarchy + Assets together) */
.eui-left-resize { position: absolute; top: 12px; bottom: 12px; width: 10px; z-index: 6; cursor: ew-resize; pointer-events: auto; }
.eui-left-resize::after { content: ''; position: absolute; left: 4px; top: 0; bottom: 0; width: 3px; border-radius: 3px; background: transparent; transition: background 0.12s; }
.eui-left-resize:hover::after { background: var(--primary); }

/* left-dock tabs (Scene | Assets) */
.eui-left-tabs { display: flex; gap: 4px; padding: 8px 8px 0; flex: none; }
.eui-ltab { flex: 1; padding: 7px 0; border: none; background: transparent; color: var(--text-3); font-size: 12px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; border-radius: 6px 6px 0 0; transition: color 0.12s, background 0.12s; }
.eui-ltab:hover { color: var(--text); background: var(--hover); }
.eui-ltab.active { color: var(--text); border-bottom-color: var(--primary); }
/* assets sub-tabs (Catalog | Local) — a compact pill, not a second tab bar */
.eui-seg { display: inline-flex; gap: 2px; margin: 8px 12px 2px; padding: 3px; background: var(--input); border-radius: 9px; flex: none; align-self: flex-start; }
.eui-seg-btn { padding: 5px 18px; border: none; background: transparent; color: var(--text-2); font-size: 11px; font-weight: 600; border-radius: 7px; cursor: pointer; transition: background 0.12s, color 0.12s; }
.eui-seg-btn:hover { color: var(--text); }
.eui-seg-btn.active { background: var(--primary); color: #fff; }
/* local-model cards reuse .eui-asset; the glyph stands in for a thumbnail
   (sizing comes from the shared ".eui-asset img, .eui-asset .glyph" rule) */
.eui-asset .glyph { display: flex; align-items: center; justify-content: center; color: var(--text-3); background: var(--paper-hi); }
.eui-asset .glyph svg { width: 44%; height: 44%; }
.eui-asset-upload { border-style: dashed; cursor: pointer; }
.eui-asset-upload .glyph { background: transparent; color: var(--primary); font-size: 32px; font-weight: 300; line-height: 1; }
.eui-asset-upload:hover { border-color: var(--primary-border); }
.eui-asset-upload:hover .name { color: var(--text); }

/* tooltip — app-wide hover label (TooltipLayer): dark, instant, design-system */
.eui-tip {
  position: fixed;
  transform: translateX(-50%);
  z-index: 1000;
  pointer-events: none;
  max-width: 280px;
  padding: 4px 8px;
  background: var(--paper-hi);
  color: var(--text);
  border: 1px solid var(--divider);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  box-shadow: var(--shadow-float);
  animation: eui-tip-in 90ms ease-out;
}
@keyframes eui-tip-in { from { opacity: 0; transform: translateX(-50%) translateY(2px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

/* ---------- UI builder ---------- */
/* Scene | UI mode switch (toolbar) */
.eui-mode-seg { display: inline-flex; gap: 2px; padding: 2px; background: var(--input); border-radius: 9px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.4), inset 0 0 0 1px var(--divider-soft); }
.eui-mode-seg button { padding: 0 12px; height: 26px; border: none; background: transparent; color: var(--text-2); font: inherit; font-size: 12px; font-weight: 600; border-radius: 7px; cursor: pointer; transition: background 0.12s, color 0.12s; }
.eui-mode-seg button:hover { color: var(--text); }
.eui-mode-seg button.active { background: var(--primary); color: #fff; }

/* canvas: sits between the left dock (264) and the inspector (320). overflow is
   clipped so a rendered UI can never spill over the toolbar. */
.eui-uib-canvas {
  position: absolute; top: 72px; left: 288px; right: 344px; bottom: 12px;
  pointer-events: auto; overflow: hidden; border-radius: 12px;
  border: 1px solid var(--divider);
}
/* scrollable viewport inside the canvas (so zoomed-in screens can pan) */
.eui-uib-scroll {
  position: absolute; inset: 0; overflow: auto; cursor: grab;
  display: flex; align-items: center; justify-content: center;
  background:
    linear-gradient(45deg, rgba(255,255,255,0.02) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.02) 75%) 0 0 / 24px 24px,
    linear-gradient(45deg, rgba(255,255,255,0.02) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.02) 75%) 12px 12px / 24px 24px,
    var(--paper);
}
/* floating preset + zoom controls (don't scroll with the canvas) */
.eui-uib-controls { position: absolute; top: 8px; right: 8px; z-index: 6; display: flex; gap: 8px; }
.eui-uib-controls .eui-mode-seg { margin: 0; }
.eui-uib-screen-fit { margin: auto; }
/* center the component within the scene screen (storybook framing) + let empty
   screen area be the pan surface */
.eui-uib-stage { display: flex; align-items: center; justify-content: center; cursor: grab; }
/* the 16:9 "screen" — the scene viewport, scaled to fit; UI inside is at scene
   proportions. The fit box carries the visible scaled size; the stage is the
   fixed 1920×1080 inner that gets CSS-scaled. */
.eui-uib-screen-fit { position: relative; flex: none; overflow: hidden; border-radius: 4px; box-shadow: var(--shadow-float); }
/* canvas backgrounds — the UI overlays the 3D world in-world, so default to a
   neutral grid; dark/light help judge contrast against extremes */
.eui-uib-screen-fit.bg-dark { background: #1e1f24; }
.eui-uib-screen-fit.bg-light { background: #e8e8ec; }
.eui-uib-screen-fit.bg-grid {
  background-color: #2a2b30;
  background-image:
    linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.05) 75%),
    linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.05) 75%);
  background-size: 28px 28px; background-position: 0 0, 14px 14px;
}
.eui-uib-stage { position: relative; }

/* resize handles on the selected element */
.eui-uib-handle {
  position: absolute; width: 8px; height: 8px; z-index: 5;
  background: var(--primary); border: 1px solid #fff; border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
}

/* palette */
.eui-uib-palette { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 6px 12px 4px; flex: none; }
.eui-uib-pal-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px;
  border: 1px solid var(--divider-soft); border-radius: 10px; background: var(--input);
  color: var(--text); font: inherit; font-size: 11px; cursor: pointer;
  transition: border-color 0.12s, transform 0.12s, box-shadow 0.12s;
}
.eui-uib-pal-btn:hover { border-color: var(--primary-border); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.28); }
.eui-uib-pal-btn .glyph { font-size: 18px; line-height: 1; color: var(--text-2); }

/* layers */
.eui-uib-layers { flex: 1; overflow-y: auto; padding: 4px 0 8px; }

/* footer (component name + generate) */
.eui-uib-foot { flex: none; padding: 10px 12px; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 8px; }
`
