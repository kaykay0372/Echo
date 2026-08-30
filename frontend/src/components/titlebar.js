export async function initTitlebar() {
	// Detect that code is running inside a Tauri window rather than a plain browser tab.
	const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

	// Dynamic import of Tauri to avoid bundling it into the frontend code, which can cause weird behaviour.
	let appWindow = null;
	if (isTauri) {
		const {getCurrentWindow} = await import("@tauri-apps/api/window");
		appWindow = getCurrentWindow();
	}

	const minimizeBtn = document.getElementById("btn-minimize");
	const maximizeBtn = document.getElementById("btn-maximize");
	const closeBtn = document.getElementById("btn-close");

	// Keep custom buttons visible as part of the UI
	document.body.classList.toggle("is-tauri", isTauri);

	// Handle missing Tauri API
	if (minimizeBtn) {
		minimizeBtn.addEventListener("click", () => {
			if (appWindow) appWindow.minimize();
			else console.warn("Tauri isn't running.");
		});
	}

	if (maximizeBtn) {
		maximizeBtn.addEventListener("click", () => {
			if (appWindow) appWindow.toggleMaximize();
			else console.warn("Tauri isn't running.");
		});
	}

	if (closeBtn) {
		closeBtn.addEventListener("click", () => {
			if (appWindow) appWindow.close();
			else console.warn("Tauri isn't running.");
		});
	}

	// Keep track of the maximised state if the window is maximized by other means (double-click on the drag region, OS shortcut, etc).
	if (appWindow && maximizeBtn) {
		const syncMaximizedState = async () => {
			const isMaximized = await appWindow.isMaximized();
			maximizeBtn.setAttribute("aria-pressed", String(isMaximized));
		};
		syncMaximizedState();
		appWindow.onResized(syncMaximizedState);
	}
}
