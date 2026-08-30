const STORAGE_KEY = "echo:linkAutoConfirm";

// Frontend-only display (non-functional yet)
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
