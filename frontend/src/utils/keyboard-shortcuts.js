// All combos use Ctrl as the modifier. Windows/Linux only for now.

function matches(event, {key, shift = false}) {
	return event.ctrlKey && event.shiftKey === shift && !event.altKey && event.key.toLowerCase() === key.toLowerCase();
}

function navigate(path) {
	location.hash = `#${path}`;
}

// Reuses the existing pin-toggle buttons' handler
function clickToggle(toggleId) {
	document.getElementById(toggleId)?.click();
}

function handleKeydown(event) {
	if (event.key === "Escape") {
		document.activeElement?.blur?.();
		return;
	}

	if (matches(event, {key: "n"})) {
		event.preventDefault();
		navigate("/note/new");
	} else if (matches(event, {key: "f", shift: true})) {
		event.preventDefault();
		document.getElementById("global-search")?.focus();
	} else if (matches(event, {key: "l", shift: true})) {
		event.preventDefault();
		navigate("/list");
	} else if (matches(event, {key: "g", shift: true})) {
		event.preventDefault();
		navigate("/graph");
	} else if (matches(event, {key: "t", shift: true})) {
		event.preventDefault();
		navigate("/tags");
	} else if (matches(event, {key: ","})) {
		event.preventDefault();
		navigate("/settings");
	} else if (matches(event, {key: "\\"})) {
		event.preventDefault();
		clickToggle("nav-pin-toggle");
	} else if (matches(event, {key: "."})) {
		event.preventDefault();
		clickToggle("right-panel-pin-toggle");
	}
}

let bound = false;

// Attached once for the app's lifetime
export function initGlobalShortcuts() {
	if (bound) return;
	document.addEventListener("keydown", handleKeydown);
	bound = true;
}

// Test-only function to reset the global shortcuts event listener
export function _resetGlobalShortcutsForTest() {
	document.removeEventListener("keydown", handleKeydown);
	bound = false;
}
