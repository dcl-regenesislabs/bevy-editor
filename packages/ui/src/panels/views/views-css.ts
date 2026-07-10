// CSS for the curated views, appended to the main sheet in styles.ts.
export const VIEWS_CSS = `
.eui-range{flex:1 1 60px;min-width:48px;height:16px;margin:0;background:transparent;accent-color:var(--primary)}
.eui-view-loading{color:var(--text-3);font-size:11px;padding:6px 2px}

/* per-property info affordance */
.eui-info{margin-left:4px;color:var(--text-3);font-size:10px;cursor:help;vertical-align:baseline}
.eui-info:hover{color:var(--primary)}
/* keep the ⓘ visible when the label text truncates */
.eui-prop > .plabel.with-doc{display:inline-flex;align-items:center;gap:2px}
.eui-prop > .plabel.with-doc .ptext{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.eui-prop > .plabel.with-doc .eui-info{flex:none;margin-left:2px}

/* collision-layer multi-select (summary button + checklist popup) */
.eui-ms{position:relative;flex:1;min-width:0}
.eui-ms-btn{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;text-align:left}
.eui-ms-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eui-ms-chev{flex:none;color:var(--text-3);font-size:9px}
.eui-ms-pop{
  position:absolute;z-index:var(--z-overlay);top:calc(100% + 4px);left:0;right:0;
  background:var(--paper-hi);border:1px solid var(--divider);border-radius:var(--r-control);
  box-shadow:var(--shadow-float);padding:4px;display:flex;flex-direction:column;gap:1px;
  max-height:220px;overflow-y:auto;animation:eui-pop .12s var(--ease-out)
}
.eui-ms-row{
  display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:7px;
  cursor:pointer;font-size:11px;color:var(--text-2)
}
.eui-ms-row:hover{background:var(--hover);color:var(--text)}

/* Script component view */
.eui-script-view{display:flex;flex-direction:column;gap:6px}
.eui-script-note{color:var(--text-3);font-size:11px}
.eui-script-dim{color:var(--text-3);font-size:10.5px;line-height:1.4}
.eui-script-dim code{font-size:10px;color:var(--text-2)}
.eui-script-ok{color:var(--ok, #7dd87d);font-size:11px}
.eui-script-err{
  color:var(--danger, #e5726d);font-size:10.5px;line-height:1.4;word-break:break-word
}
.eui-script-entry{
  display:flex;flex-direction:column;gap:3px;padding:5px 6px;
  background:var(--hover, rgba(255,255,255,.03));border-radius:var(--r-control)
}
.eui-script-head{display:flex;align-items:center;gap:2px;min-width:0;margin-bottom:2px}
.eui-script-head .path{
  font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap
}
.eui-script-head .spacer{flex:1}
.eui-script-priority{max-width:64px;flex:0 0 auto}
.eui-script-actions{display:flex;gap:10px;align-items:center}
.eui-script-btn{height:24px;box-shadow:inset 0 0 0 1px var(--divider);font-size:12px}
.eui-script-btn:hover{box-shadow:inset 0 0 0 1px var(--divider);background:var(--hover)}
.eui-script-studio-btn{
  display:flex;align-items:center;justify-content:center;gap:6px;width:100%;
  height:32px;margin-top:8px;border-radius:var(--r-control);cursor:pointer;
  background:var(--primary-selected);color:var(--primary);
  border:1px solid var(--primary-border);font:600 12.5px/1 var(--font-family);
  transition:background .12s,color .12s;
}
.eui-script-studio-btn:hover:not(:disabled){background:var(--primary);color:#fff}
.eui-script-studio-btn:disabled{opacity:.5;cursor:default}
.eui-script-studio-btn svg{width:15px;height:15px}
.eui-script-add{display:flex;flex-direction:column;gap:6px}
.eui-script-add-hint{color:var(--text-3);font-size:10px;word-break:break-all}

/* Asset picker modal — one scroll area, no nested scrollbars */
.eui-asset-picker{width:min(620px,90vw);max-width:none;height:min(560px,80vh);display:flex;flex-direction:column}
.eui-ap-head{display:flex;align-items:center;gap:10px}
.eui-ap-head .spacer{flex:1}
.eui-ap-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:4px 18px 8px}
.eui-ap-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px}
.eui-ap-row{
  display:flex;align-items:baseline;gap:8px;padding:6px 8px;border-radius:7px;
  cursor:pointer;font-size:12px;min-width:0
}
.eui-ap-row:hover{background:var(--hover)}
.eui-ap-row.on{background:var(--primary-selected)}
.eui-ap-row.free{color:var(--primary);font-style:italic}
.eui-ap-row .name{font-weight:600;flex:none}
.eui-ap-row .dir{color:var(--text-3);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eui-asset.busy{opacity:.55;pointer-events:none}

/* Script code editor modal */
.eui-script-editor{width:min(860px,92vw);max-width:none;display:flex;flex-direction:column}
.eui-script-editor .eui-modal-head{display:flex;align-items:center;gap:8px}
.eui-script-editor .eui-modal-head .spacer{flex:1}
.eui-script-editor-title{font-family:var(--mono, ui-monospace, monospace);font-size:11px}
.eui-script-editor-body{
  height:min(560px,64vh);margin:0 18px;overflow:hidden;border:1px solid var(--divider);
  border-radius:var(--r-control);text-align:left
}
.eui-script-editor-body .cm-editor{height:100%;font-size:12px}
.eui-script-editor-body .cm-scroller{overflow:auto}
`
