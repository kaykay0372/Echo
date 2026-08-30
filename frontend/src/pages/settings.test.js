import {beforeEach, describe, expect, it} from "vitest";
import {installRealTemplates} from "../utils/install-real-templates.js";
import {renderSettings} from "./settings.js";
import {getLinkAutoConfirm} from "../utils/link-behaviour.js";

beforeEach(() => {
	window.localStorage.clear();
	document.body.innerHTML = `<main id="content"></main>`;
	installRealTemplates();
});

describe("renderSettings link behaviour toggle", () => {
	it("defaults to Manual approval selected", () => {
		renderSettings();
		expect(document.querySelector('[data-link-mode="manual"]').getAttribute("aria-pressed")).toBe("true");
		expect(document.querySelector('[data-link-mode="auto"]').getAttribute("aria-pressed")).toBe("false");
	});

	it("clicking Auto-confirm persists it and updates state", () => {
		renderSettings();
		document.querySelector('[data-link-mode="auto"]').click();

		expect(getLinkAutoConfirm()).toBe(true);
		expect(document.querySelector('[data-link-mode="auto"]').getAttribute("aria-pressed")).toBe("true");
		expect(document.querySelector('[data-link-mode="manual"]').getAttribute("aria-pressed")).toBe("false");
	});

	it("clicking back to Manual approval persists state too", () => {
		renderSettings();
		document.querySelector('[data-link-mode="auto"]').click();
		document.querySelector('[data-link-mode="manual"]').click();

		expect(getLinkAutoConfirm()).toBe(false);
		expect(document.querySelector('[data-link-mode="manual"]').getAttribute("aria-pressed")).toBe("true");
	});
});

describe("renderSettings keyboard shortcuts reference", () => {
	it("lists at least one shortcut", () => {
		renderSettings();
		expect(document.querySelectorAll(".settings-shortcuts-list-row").length).toBeGreaterThan(0);
	});
});
