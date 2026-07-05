// CSS for the curated views, appended to the main sheet in styles.ts.
export const VIEWS_CSS = `
.eui-range{flex:1 1 60px;min-width:48px;height:16px;margin:0;background:transparent;accent-color:var(--primary)}
.eui-view-loading{color:var(--text-3);font-size:11px;padding:6px 2px}

/* per-property info affordance */
.eui-info{margin-left:4px;color:var(--text-3);font-size:10px;cursor:help;vertical-align:baseline}
.eui-info:hover{color:var(--primary)}

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
`
