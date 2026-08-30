import {beforeEach, afterEach, describe, expect, it} from "vitest";
import {createCollapsiblePanel, NARROW_BREAKPOINT_PX} from "./collapsible-panel.js";

function setWidth(px) {
	window.innerWidth = px;
}

function renderFixture() {
	document.body.innerHTML = `
		<div id="panel"></div>
		<button id="toggle" aria-pressed="false"></button>
	`;
}

beforeEach(() => {
	window.localStorage.clear();
	setWidth(1024);
	renderFixture();
	activePanels = [];
});

afterEach(() => {
	activePanels.forEach((p) => p.destroy());
	activePanels = [];
	setWidth(1024);
});

let activePanels = [];

function makePanel(overrides = {}) {
	const panel = createCollapsiblePanel({
		panelId: "panel",
		toggleId: "toggle",
		storageKeyPrefix: "echo:test-panel",
		collapsedClass: "is-collapsed",
		pinnedClass: "is-pinned",
		pinnedLabel: "Keep panel open",
		pinnedLabelActive: "Keep panel open (pinned)",
		...overrides,
	});
	activePanels.push(panel);
	return panel;
}

describe("createCollapsiblePanel basic pin/unpin", () => {
	it("starts unpinned and not collapsed by default at a normal window width", () => {
		makePanel().init();
		const panel = document.getElementById("panel");
		expect(panel.classList.contains("is-collapsed")).toBe(false);
		expect(panel.classList.contains("is-pinned")).toBe(false);
	});

	it("clicking the toggle pins the panel and sets aria-pressed", () => {
		makePanel().init();
		document.getElementById("toggle").click();

		expect(document.getElementById("panel").classList.contains("is-pinned")).toBe(true);
		expect(document.getElementById("toggle").getAttribute("aria-pressed")).toBe("true");
	});

	it("persists the pinned state across a fresh init() (e.g. a reload)", () => {
		makePanel().init();
		document.getElementById("toggle").click();

		renderFixture();
		makePanel().init();

		expect(document.getElementById("panel").classList.contains("is-pinned")).toBe(true);
	});

	it("blurs the toggle on unpin so lingering focus doesn't override mouse-leave collapse", () => {
		makePanel().init();
		const toggle = document.getElementById("toggle");
		toggle.focus();
		toggle.click(); // pin
		toggle.click(); // unpin
		expect(document.activeElement).not.toBe(toggle);
	});
});

describe("createCollapsiblePanel setForceCollapsed", () => {
	it("collapses the panel when forced, even if not pinned", () => {
		const panel = makePanel();
		panel.init();
		panel.setForceCollapsed(true);
		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(true);
	});

	it("un-collapses when force is lifted, back to the default (unpinned) state", () => {
		const panel = makePanel();
		panel.init();
		panel.setForceCollapsed(true);
		panel.setForceCollapsed(false);
		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(false);
	});
});

describe("createCollapsiblePanel narrow window auto-collapse", () => {
	it("collapses automatically when the window starts narrow", () => {
		setWidth(NARROW_BREAKPOINT_PX - 100);
		makePanel().init();
		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(true);
	});

	it("collapses on resize below the breakpoint, even if nothing else changed", () => {
		makePanel().init();
		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(false);

		setWidth(NARROW_BREAKPOINT_PX - 50);
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(true);
	});

	it("expands again once the window widens back past the breakpoint", () => {
		makePanel().init();
		setWidth(NARROW_BREAKPOINT_PX - 50);
		window.dispatchEvent(new Event("resize"));
		setWidth(NARROW_BREAKPOINT_PX + 50);
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(false);
	});

	it("a narrow window overrides a manual pin", () => {
		makePanel().init();
		document.getElementById("toggle").click();

		setWidth(NARROW_BREAKPOINT_PX - 50);
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("panel").classList.contains("is-pinned")).toBe(false);
		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(true);
	});

	it("restores the pin once the window widens again", () => {
		makePanel().init();
		document.getElementById("toggle").click();

		setWidth(NARROW_BREAKPOINT_PX - 50);
		window.dispatchEvent(new Event("resize"));
		setWidth(NARROW_BREAKPOINT_PX + 50);
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("panel").classList.contains("is-pinned")).toBe(true);
	});

	it("destroy() stops listening to resize", () => {
		const panel = makePanel();
		panel.init();
		panel.destroy();

		setWidth(NARROW_BREAKPOINT_PX - 50);
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("panel").classList.contains("is-collapsed")).toBe(false);
	});
});
