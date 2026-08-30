import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {initGlobalShortcuts, _resetGlobalShortcutsForTest} from "./keyboard-shortcuts.js";

function fireKeydown({key, ctrlKey = false, metaKey = false, shiftKey = false, altKey = false, target} = {}) {
	const event = new KeyboardEvent("keydown", {
		key,
		ctrlKey,
		metaKey,
		shiftKey,
		altKey,
		bubbles: true,
		cancelable: true,
	});
	(target || document).dispatchEvent(event);
	return event;
}

beforeEach(() => {
	document.body.innerHTML = `
		<input id="global-search" type="search" />
		<button id="nav-pin-toggle" aria-pressed="false"></button>
		<button id="right-panel-pin-toggle" aria-pressed="false"></button>
	`;
	location.hash = "";
	initGlobalShortcuts();
});

afterEach(() => {
	_resetGlobalShortcutsForTest();
	vi.restoreAllMocks();
});

describe("initGlobalShortcuts navigation", () => {
	it("Ctrl+N navigates to a new note", () => {
		fireKeydown({key: "n", ctrlKey: true});
		expect(location.hash).toBe("#/note/new");
	});

	it("Ctrl+Shift+L navigates to the notes list", () => {
		fireKeydown({key: "L", ctrlKey: true, shiftKey: true});
		expect(location.hash).toBe("#/list");
	});

	it("Ctrl+Shift+G navigates to the graph", () => {
		fireKeydown({key: "G", ctrlKey: true, shiftKey: true});
		expect(location.hash).toBe("#/graph");
	});

	it("Ctrl+Shift+T navigates to tags", () => {
		fireKeydown({key: "T", ctrlKey: true, shiftKey: true});
		expect(location.hash).toBe("#/tags");
	});

	it("Ctrl+, navigates to settings", () => {
		fireKeydown({key: ",", ctrlKey: true});
		expect(location.hash).toBe("#/settings");
	});

	it("Ctrl+Shift+F focuses the global search input", () => {
		fireKeydown({key: "F", ctrlKey: true, shiftKey: true});
		expect(document.activeElement).toBe(document.getElementById("global-search"));
	});
});

describe("initGlobalShortcuts - panel toggles", () => {
	it("Ctrl+\\ clicks the nav pin toggle", () => {
		const toggle = document.getElementById("nav-pin-toggle");
		const clickSpy = vi.spyOn(toggle, "click");
		fireKeydown({key: "\\", ctrlKey: true});
		expect(clickSpy).toHaveBeenCalledOnce();
	});

	it("Ctrl+. clicks the right-panel pin toggle", () => {
		const toggle = document.getElementById("right-panel-pin-toggle");
		const clickSpy = vi.spyOn(toggle, "click");
		fireKeydown({key: ".", ctrlKey: true});
		expect(clickSpy).toHaveBeenCalledOnce();
	});

	it("does nothing if the right-panel toggle isn't mounted", () => {
		document.getElementById("right-panel-pin-toggle").remove();
		expect(() => fireKeydown({key: ".", ctrlKey: true})).not.toThrow();
	});
});

describe("initGlobalShortcuts Escape", () => {
	it("blurs the currently focused element", () => {
		const input = document.getElementById("global-search");
		input.focus();
		expect(document.activeElement).toBe(input);

		fireKeydown({key: "Escape"});
		expect(document.activeElement).not.toBe(input);
	});
});

describe("initGlobalShortcuts doesn't fire without the modifier", () => {
	it("plain 'n' (no Ctrl) does not navigate", () => {
		fireKeydown({key: "n"});
		expect(location.hash).toBe("");
	});

	it("Ctrl+N without Shift is 'new note'", () => {
		fireKeydown({key: "n", ctrlKey: true, shiftKey: true});
		expect(location.hash).toBe("");
	});
});

describe("initGlobalShortcuts idempotent init", () => {
	it("calling initGlobalShortcuts again does not attach a second listener", () => {
		const addSpy = vi.spyOn(document, "addEventListener");
		initGlobalShortcuts();
		expect(addSpy).not.toHaveBeenCalled();
	});
});
