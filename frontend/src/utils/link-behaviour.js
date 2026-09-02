const STORAGE_KEY = "echo:linkAutoConfirm";

// Persisted user preference read by right-panel.js's refresh().
export function getLinkAutoConfirm() {
	try {
		return window.localStorage.getItem(STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

export function setLinkAutoConfirm(value) {
	try {
		window.localStorage.setItem(STORAGE_KEY, String(!!value));
	} catch {
		// Non-fatal
	}
}
