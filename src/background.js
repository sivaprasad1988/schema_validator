// Toolbar icon opens the panel.
// Firefox: sidebar_action (toggle must run directly in the click handler).
// Chrome: side_panel with openPanelOnActionClick.
const api = globalThis.browser ?? globalThis.chrome;

if (api.sidebarAction?.toggle) {
  api.action.onClicked.addListener(() => {
    api.sidebarAction.toggle();
  });
} else if (api.sidePanel?.setPanelBehavior) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
}
