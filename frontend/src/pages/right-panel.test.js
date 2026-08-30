import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../api/client.js", () => ({
	getNoteLinks: vi.fn(),
	getNote: vi.fn(),
	confirmLink: vi.fn(),
	rejectLink: vi.fn(),
}));

import {getNoteLinks, getNote, confirmLink, rejectLink} from "../api/client.js";
import {renderRightPanel} from "./right-panel.js";

const NOTE_ID = "note-1";
const OTHER_ID = "note-2";
const TEST_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function confirmedLink(overrides = {}) {
	return {
		id: "link-1",
		source_note_id: NOTE_ID,
		target_note_id: OTHER_ID,
		link_type: "automatic",
		similarity_score: 0.82,
		status: "confirmed",
		created_at: TEST_TIMESTAMP,
		confirmed_at: TEST_TIMESTAMP,
		...overrides,
	};
}

function pendingLink(overrides = {}) {
	return {
		id: "link-2",
		source_note_id: OTHER_ID,
		target_note_id: NOTE_ID,
		link_type: "automatic",
		similarity_score: 0.71,
		status: "pending_approval",
		created_at: TEST_TIMESTAMP,
		confirmed_at: null,
		...overrides,
	};
}

let container;

beforeEach(() => {
	container = document.createElement("div");
	vi.clearAllMocks();
	window.localStorage.clear(); // getLinkAutoConfirm defaults to manual (false)
	location.hash = "";
	getNote.mockResolvedValue({id: OTHER_ID, title: "The Other Note"});
});

describe("renderRightPanel", () => {
	it("shows an empty state when there are no links", async () => {
		getNoteLinks.mockResolvedValue([]);

		await renderRightPanel(container, NOTE_ID);

		expect(container.textContent).toContain("No connections yet");
	});

	it("renders confirmed links as backlinks", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "confirmed" ? [confirmedLink()] : []),
		);

		await renderRightPanel(container, NOTE_ID);

		expect(container.textContent).toContain("Backlinks");
		expect(container.textContent).toContain("The Other Note");
		expect(getNote).toHaveBeenCalledWith(OTHER_ID);
	});

	it("works out the other note correctly regardless of which side the current note is on", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "pending_approval" ? [pendingLink()] : []),
		);

		await renderRightPanel(container, NOTE_ID);

		const link = container.querySelector(".connections-list-link");
		expect(link.getAttribute("href")).toBe(`#/note/${OTHER_ID}`);
	});

	it("only fetches each other-note's title once even if it appears in multiple links", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "confirmed" ? [confirmedLink({id: "a"}), confirmedLink({id: "b"})] : []),
		);

		await renderRightPanel(container, NOTE_ID);

		expect(getNote).toHaveBeenCalledTimes(1);
	});

	it("shows Confirm/Reject actions only for pending links, not confirmed ones", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(
				status === "confirmed" ? [confirmedLink()] : status === "pending_approval" ? [pendingLink()] : [],
			),
		);

		await renderRightPanel(container, NOTE_ID);

		const pendingSection = [...container.querySelectorAll("section")].find(
			(s) => s.getAttribute("aria-label") === "Pending approval",
		);
		const backlinksSection = [...container.querySelectorAll("section")].find(
			(s) => s.getAttribute("aria-label") === "Backlinks",
		);

		expect(pendingSection.querySelector(".connections-list-action-confirm")).not.toBeNull();
		expect(backlinksSection.querySelector(".connections-list-action-confirm")).toBeNull();
	});

	it("confirming a pending link calls confirmLink and refreshes the panel", async () => {
		let isConfirmed = false;
		getNoteLinks.mockImplementation((_id, status) => {
			if (status === "pending_approval") return Promise.resolve(isConfirmed ? [] : [pendingLink()]);
			if (status === "confirmed") return Promise.resolve(isConfirmed ? [pendingLink({status: "confirmed"})] : []);
			return Promise.resolve([]);
		});
		confirmLink.mockImplementation(async () => {
			isConfirmed = true;
		});

		await renderRightPanel(container, NOTE_ID);
		const confirmBtn = container.querySelector(".connections-list-action-confirm");
		confirmBtn.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		// Let the async click handler's confirmLink()+refresh() resolve.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(confirmLink).toHaveBeenCalledWith("link-2");
		expect(container.textContent).toContain("Backlinks");
	});

	it("cleanup empties the container", async () => {
		getNoteLinks.mockResolvedValue([]);

		const cleanup = await renderRightPanel(container, NOTE_ID);
		cleanup();

		expect(container.innerHTML).toBe("");
	});

	it("clicking anywhere in a row navigates to the other note, not just the title text", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "confirmed" ? [confirmedLink()] : []),
		);

		await renderRightPanel(container, NOTE_ID);
		const row = container.querySelector(".connections-list-item");
		row.dispatchEvent(new MouseEvent("click", {bubbles: true}));

		expect(location.hash).toBe(`#/note/${OTHER_ID}`);
	});

	it("clicking a Confirm/Reject button does not also trigger row navigation", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "pending_approval" ? [pendingLink()] : []),
		);
		confirmLink.mockResolvedValue();

		await renderRightPanel(container, NOTE_ID);
		container
			.querySelector(".connections-list-action-confirm")
			.dispatchEvent(new MouseEvent("click", {bubbles: true}));

		expect(location.hash).toBe("");
	});
});

describe("renderRightPanel auto-confirm display mode", () => {
	it("folds pending links into the same list as confirmed ones, without action buttons", async () => {
		window.localStorage.setItem("echo:linkAutoConfirm", "true");
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(
				status === "confirmed"
					? [confirmedLink({id: "a"})]
					: status === "pending_approval"
						? [pendingLink({id: "b"})]
						: [],
			),
		);

		await renderRightPanel(container, NOTE_ID);

		// Single merged section, not separate Pending approval / Backlinks.
		const sections = container.querySelectorAll("section");
		expect(sections).toHaveLength(1);
		expect(sections[0].getAttribute("aria-label")).toBe("Connections");
		expect(container.querySelectorAll(".connections-list-item")).toHaveLength(2);
		expect(container.querySelector(".connections-list-action-confirm")).toBeNull();
		expect(container.querySelector(".connections-list-action-reject")).toBeNull();
		expect(container.querySelector(".connections-section-heading")).toBeNull();
	});

	it("calls confirmLink for every pending link, not just a UI change", async () => {
		window.localStorage.setItem("echo:linkAutoConfirm", "true");
		let confirmedIds = [];
		getNoteLinks.mockImplementation((_id, status) => {
			if (status === "pending_approval") {
				return Promise.resolve(
					[pendingLink({id: "a"}), pendingLink({id: "b"})].filter((l) => !confirmedIds.includes(l.id)),
				);
			}
			return Promise.resolve([]);
		});
		confirmLink.mockImplementation(async (linkId) => {
			confirmedIds.push(linkId);
		});

		await renderRightPanel(container, NOTE_ID);

		expect(confirmLink).toHaveBeenCalledWith("a");
		expect(confirmLink).toHaveBeenCalledWith("b");
		expect(confirmLink).toHaveBeenCalledTimes(2);
	});

	it("re-fetches after auto-confirming, so the badge and list reflect what's actually pending, not the pre-confirm count", async () => {
		window.localStorage.setItem("echo:linkAutoConfirm", "true");
		let alreadyConfirmed = false;
		getNoteLinks.mockImplementation((_id, status) => {
			if (status === "pending_approval") return Promise.resolve(alreadyConfirmed ? [] : [pendingLink()]);
			if (status === "confirmed")
				return Promise.resolve(alreadyConfirmed ? [pendingLink({status: "confirmed"})] : []);
			return Promise.resolve([]);
		});
		confirmLink.mockImplementation(async () => {
			alreadyConfirmed = true;
		});
		const onPendingCountChange = vi.fn();

		await renderRightPanel(container, NOTE_ID, {onPendingCountChange});

		expect(onPendingCountChange).toHaveBeenLastCalledWith(0);
	});

	it("a failed auto-confirm is logged and doesn't block the rest of the panel from rendering", async () => {
		window.localStorage.setItem("echo:linkAutoConfirm", "true");
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "pending_approval" ? [pendingLink()] : []),
		);
		confirmLink.mockRejectedValue(new Error("network down"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await renderRightPanel(container, NOTE_ID);

		expect(errorSpy).toHaveBeenCalled();
		expect(container.querySelectorAll(".connections-list-item")).toHaveLength(1);
	});

	it("manual mode never calls confirmLink", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "pending_approval" ? [pendingLink()] : []),
		);

		await renderRightPanel(container, NOTE_ID);

		expect(confirmLink).not.toHaveBeenCalled();
	});

	it("still shows the empty state when there's nothing to show, in either mode", async () => {
		window.localStorage.setItem("echo:linkAutoConfirm", "true");
		getNoteLinks.mockResolvedValue([]);

		await renderRightPanel(container, NOTE_ID);

		expect(container.textContent).toContain("No connections yet");
	});

	it("manual mode (default) keeps the separate Pending approval / Backlinks sections", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(
				status === "confirmed"
					? [confirmedLink()]
					: status === "pending_approval"
						? [pendingLink({id: "b"})]
						: [],
			),
		);

		await renderRightPanel(container, NOTE_ID);

		const labels = [...container.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
		expect(labels.sort()).toEqual(["Backlinks", "Pending approval"]);

		const visibleHeadings = [...container.querySelectorAll(".connections-section-heading")].map(
			(h) => h.textContent,
		);
		expect(visibleHeadings.sort()).toEqual(["Backlinks", "Pending approval"]);
	});
});

describe("renderRightPanel onPendingCountChange callback", () => {
	it("reports the pending count after a successful load", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "pending_approval" ? [pendingLink({id: "a"}), pendingLink({id: "b"})] : []),
		);
		const onPendingCountChange = vi.fn();

		await renderRightPanel(container, NOTE_ID, {onPendingCountChange});

		expect(onPendingCountChange).toHaveBeenCalledWith(2);
	});

	it("reports 0 when there are no pending links", async () => {
		getNoteLinks.mockResolvedValue([]);
		const onPendingCountChange = vi.fn();

		await renderRightPanel(container, NOTE_ID, {onPendingCountChange});

		expect(onPendingCountChange).toHaveBeenCalledWith(0);
	});

	it("reports the count again after a confirm/reject changes it", async () => {
		let pendingCount = 1;
		getNoteLinks.mockImplementation((_id, status) => {
			if (status === "pending_approval") return Promise.resolve(pendingCount ? [pendingLink()] : []);
			return Promise.resolve([]);
		});
		confirmLink.mockImplementation(async () => {
			pendingCount = 0;
		});
		const onPendingCountChange = vi.fn();

		await renderRightPanel(container, NOTE_ID, {onPendingCountChange});
		expect(onPendingCountChange).toHaveBeenLastCalledWith(1);

		container
			.querySelector(".connections-list-action-confirm")
			.dispatchEvent(new MouseEvent("click", {bubbles: true}));
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(onPendingCountChange).toHaveBeenLastCalledWith(0);
	});

	it("reports 0 on cleanup, so a collapsed badge doesn't linger after navigating away", async () => {
		getNoteLinks.mockImplementation((_id, status) =>
			Promise.resolve(status === "pending_approval" ? [pendingLink()] : []),
		);
		const onPendingCountChange = vi.fn();

		const cleanup = await renderRightPanel(container, NOTE_ID, {onPendingCountChange});
		onPendingCountChange.mockClear();
		cleanup();

		expect(onPendingCountChange).toHaveBeenCalledWith(0);
	});

	it("reports 0 if the initial load fails, rather than leaving a stale/undefined badge", async () => {
		getNoteLinks.mockRejectedValue(new Error("network down"));
		const onPendingCountChange = vi.fn();

		await renderRightPanel(container, NOTE_ID, {onPendingCountChange});

		expect(onPendingCountChange).toHaveBeenCalledWith(0);
	});

	it("existing callers that don't pass onPendingCountChange still work", async () => {
		getNoteLinks.mockResolvedValue([]);
		await expect(renderRightPanel(container, NOTE_ID)).resolves.not.toThrow();
	});
});
