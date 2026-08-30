import {createCollapsiblePanel} from "../utils/collapsible-panel.js";

// Identify nav panel state in LocalStorage to persist across reloads
const STORAGE_PREFIX = "echo:nav";

function readSectionBool(key, fallback) {
	/* Read from LocalStorage */
	try {
		const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
		return raw === null ? fallback : raw === "true";
	} catch {
		return fallback;
	}
}

function writeSectionBool(key, value) {
	/* Write to LocalStorage, but don't throw if the user has disabled it */
	try {
		window.localStorage.setItem(`${STORAGE_PREFIX}:${key}`, String(value));
	} catch {
		// State won't reload this session
	}
}

const navPanel = createCollapsiblePanel({
	panelId: "nav",
	toggleId: "nav-pin-toggle",
	storageKeyPrefix: STORAGE_PREFIX,
	collapsedClass: "nav-collapsed",
	pinnedClass: "nav-pinned",
	pinnedLabel: "Keep navigation panel open",
	pinnedLabelActive: "Keep navigation panel open (pinned)",
});

export function initNav() {
	/* Set up the nav section headers to toggle their lists and persist state */
	document.querySelectorAll(".nav-section > button").forEach((header) => {
		const section = header.closest(".nav-section");
		const sectionId = section?.getAttribute("data-section") || header.id;
		const list = document.getElementById(header.getAttribute("aria-controls"));
		const chevron = header.querySelector(".chevron");

		// Default to "open" unless explicitly collapsed in a previous session
		const markupDefault = header.getAttribute("aria-expanded") === "true";
		const expanded = readSectionBool(`section:${sectionId}`, markupDefault);

		header.setAttribute("aria-expanded", String(expanded));
		list.hidden = !expanded;
		chevron?.classList.toggle("rotate-180", expanded);

		header.addEventListener("click", () => {
			const nowExpanded = header.getAttribute("aria-expanded") !== "true";
			header.setAttribute("aria-expanded", String(nowExpanded));
			list.hidden = !nowExpanded;
			chevron?.classList.toggle("rotate-180", nowExpanded);
			writeSectionBool(`section:${sectionId}`, nowExpanded);
		});
	});

	navPanel.init();
}

export function setNavCollapsed(collapsed) {
	/* Force the navigation panel to collapse */
	navPanel.setForceCollapsed(collapsed);
}
