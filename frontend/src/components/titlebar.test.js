import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// Hoist constants for the mock
const fakeAppWindow = vi.hoisted(() => ({
	minimize: vi.fn(),
	toggleMaximize: vi.fn(),
	close: vi.fn(),
	isMaximized: vi.fn().mockResolvedValue(false),
	onResized: vi.fn(),
}));

// Render a fake Tauri window
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => fakeAppWindow,
}));

function renderTitlebarFixture() {
	document.body.innerHTML = `
		<button id="btn-minimize"></button>
		<button id="btn-maximize"></button>
		<button id="btn-close"></button>
	`;
}

describe("initTitlebar in a plain browser window", () => {
	beforeEach(() => {
		renderTitlebarFixture();
		delete window.__TAURI__;
	});

	it("warns instead of throwing when the window controls are clicked", async () => {
		const {initTitlebar} = await import("./titlebar.js");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await initTitlebar();
		document.getElementById("btn-minimize").click();
		document.getElementById("btn-maximize").click();
		document.getElementById("btn-close").click();

		expect(warnSpy).toHaveBeenCalledTimes(3);
		warnSpy.mockRestore();
	});
});

describe("initTitlebar with missing window control buttons", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		delete window.__TAURI__;
	});

	it("does not throw when the window control buttons aren't in the DOM", async () => {
		const {initTitlebar} = await import("./titlebar.js");
		await expect(initTitlebar()).resolves.toBeUndefined();
	});
});

describe("initTitlebar sets the is-tauri body class", () => {
	afterEach(() => {
		delete window.__TAURI__;
		document.body.classList.remove("is-tauri");
	});

	it("does not set is-tauri on the body outside a Tauri window", async () => {
		renderTitlebarFixture();
		delete window.__TAURI__;
		const {initTitlebar} = await import("./titlebar.js");
		await initTitlebar();
		expect(document.body.classList.contains("is-tauri")).toBe(false);
	});

	it("sets is-tauri on the body inside a Tauri window", async () => {
		renderTitlebarFixture();
		window.__TAURI__ = {};
		const {initTitlebar} = await import("./titlebar.js");
		await initTitlebar();
		expect(document.body.classList.contains("is-tauri")).toBe(true);
	});
});

describe("initTitlebar is inside a real Tauri window", () => {
	beforeEach(() => {
		renderTitlebarFixture();
		window.__TAURI__ = {};
	});

	afterEach(() => {
		delete window.__TAURI__;
		vi.clearAllMocks();
	});

	it("calls the real window API methods instead of warning", async () => {
		const {initTitlebar} = await import("./titlebar.js");
		await initTitlebar();

		document.getElementById("btn-minimize").click();
		document.getElementById("btn-maximize").click();
		document.getElementById("btn-close").click();

		expect(fakeAppWindow.minimize).toHaveBeenCalledTimes(1);
		expect(fakeAppWindow.toggleMaximize).toHaveBeenCalledTimes(1);
		expect(fakeAppWindow.close).toHaveBeenCalledTimes(1);
	});

	it("syncs the maximize button's aria-pressed state on load", async () => {
		const {initTitlebar} = await import("./titlebar.js");
		await initTitlebar();

		expect(fakeAppWindow.isMaximized).toHaveBeenCalled();
		expect(document.getElementById("btn-maximize").getAttribute("aria-pressed")).toBe("false");
	});
});
