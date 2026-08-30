import {beforeEach, describe, expect, it, vi} from "vitest";
import {installRealTemplates} from "../utils/install-real-templates.js";

vi.mock("../api/client.js", () => ({
	listNotesPage: vi.fn(),
	deleteNote: vi.fn(),
	restoreNote: vi.fn(),
	permanentlyDeleteNote: vi.fn(),
	listTags: vi.fn(),
}));
vi.mock("../components/nav.js", () => ({setNavCollapsed: vi.fn()}));

import {listNotesPage, deleteNote, restoreNote, permanentlyDeleteNote, listTags} from "../api/client.js";
import {renderNotesList} from "./notes-list.js";

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = `<main id="content"></main>`;
	installRealTemplates();
	listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
});

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("renderNotesList active notes mode", () => {
	it("renders a row per note with title, updated date and word count", async () => {
		listNotesPage.mockResolvedValue({
			notes: [{id: "n1", title: "Hello", updated_at: "2026-01-01T00:00:00.000Z", word_count: 12}],
			nextCursor: null,
		});

		await renderNotesList({trashMode: false});
		await flush();

		const row = document.querySelector(".notes-list-row");
		expect(row.textContent).toContain("Hello");
		expect(row.textContent).toContain("12");
		expect(document.querySelector(".notes-list-title-link").getAttribute("href")).toBe("#/note/n1");
	});

	it("shows an empty state when there are no notes", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({trashMode: false});
		await flush();
		expect(document.querySelector(".notes-list-status").textContent).toContain("No notes yet");
	});

	it("shows a favourite star only for favourited notes", async () => {
		listNotesPage.mockResolvedValue({
			notes: [
				{id: "n1", title: "Fav", is_favourite: true},
				{id: "n2", title: "Not fav", is_favourite: false},
			],
			nextCursor: null,
		});
		await renderNotesList({trashMode: false});
		await flush();

		const rows = [...document.querySelectorAll(".notes-list-row")];
		const favRow = rows.find((r) => r.textContent.includes("Fav"));
		const notFavRow = rows.find((r) => r.textContent.includes("Not fav"));
		expect(favRow.querySelector(".notes-list-favourite-star")).not.toBeNull();
		expect(notFavRow.querySelector(".notes-list-favourite-star")).toBeNull();
	});

	it("Delete calls deleteNote and removes the row", async () => {
		listNotesPage.mockResolvedValue({notes: [{id: "n1", title: "Gone soon"}], nextCursor: null});
		deleteNote.mockResolvedValue();
		await renderNotesList({trashMode: false});
		await flush();

		document.querySelector(".notes-list-action").click();
		await flush();

		expect(deleteNote).toHaveBeenCalledWith("n1");
		expect(document.querySelector(".notes-list-row")).toBeNull();
	});

	it("shows Load more only when there's a next cursor, and fetches the next page on click", async () => {
		listNotesPage.mockResolvedValueOnce({notes: [{id: "n1", title: "A"}], nextCursor: "cursor-1"});
		await renderNotesList({trashMode: false});
		await flush();

		const loadMore = document.querySelector("#notes-list-load-more");
		expect(loadMore.hidden).toBe(false);

		listNotesPage.mockResolvedValueOnce({notes: [{id: "n2", title: "B"}], nextCursor: null});
		loadMore.click();
		await flush();

		expect(listNotesPage).toHaveBeenLastCalledWith(expect.objectContaining({cursor: "cursor-1"}));
		expect(document.querySelectorAll(".notes-list-row")).toHaveLength(2);
		expect(loadMore.hidden).toBe(true);
	});
});

describe("renderNotesList trash mode", () => {
	it("requests deletedOnly notes", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({trashMode: true});
		await flush();
		expect(listNotesPage).toHaveBeenCalledWith(expect.objectContaining({deletedOnly: true}));
	});

	it("shows Restore and Delete forever instead of Delete", async () => {
		listNotesPage.mockResolvedValue({notes: [{id: "n1", title: "Trashed"}], nextCursor: null});
		await renderNotesList({trashMode: true});
		await flush();

		const actions = [...document.querySelectorAll(".notes-list-action")].map((b) => b.textContent);
		expect(actions).toContain("Restore");
		expect(actions).toContain("Delete forever");
	});

	it("Restore calls restoreNote and removes the row", async () => {
		listNotesPage.mockResolvedValue({notes: [{id: "n1", title: "Trashed"}], nextCursor: null});
		restoreNote.mockResolvedValue();
		await renderNotesList({trashMode: true});
		await flush();

		[...document.querySelectorAll(".notes-list-action")].find((b) => b.textContent === "Restore").click();
		await flush();

		expect(restoreNote).toHaveBeenCalledWith("n1");
		expect(document.querySelector(".notes-list-row")).toBeNull();
	});

	it("Delete forever requires a second click to confirm before calling permanentlyDeleteNote", async () => {
		listNotesPage.mockResolvedValue({notes: [{id: "n1", title: "Trashed"}], nextCursor: null});
		permanentlyDeleteNote.mockResolvedValue();
		await renderNotesList({trashMode: true});
		await flush();

		const deleteBtn = [...document.querySelectorAll(".notes-list-action")].find(
			(b) => b.textContent === "Delete forever",
		);

		deleteBtn.click(); // first click just arms it
		expect(permanentlyDeleteNote).not.toHaveBeenCalled();
		expect(deleteBtn.textContent).toBe("Confirm delete?");

		deleteBtn.click(); // second click deletes
		await flush();

		expect(permanentlyDeleteNote).toHaveBeenCalledWith("n1");
		expect(document.querySelector(".notes-list-row")).toBeNull();
	});
});

describe("renderNotesList graph view toggle link", () => {
	it("shows a View as graph link on the default (active-notes) list", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({trashMode: false});
		await flush();
		expect(document.querySelector(".notes-list-graph-view-link").hidden).toBe(false);
	});

	it("hides it on the Trash page", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({trashMode: true});
		await flush();
		expect(document.querySelector(".notes-list-graph-view-link").hidden).toBe(true);
	});

	it("hides it on a tag-filtered list", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({tagId: "t1"});
		await flush();
		expect(document.querySelector(".notes-list-graph-view-link").hidden).toBe(true);
	});
});

describe("renderNotesList tag-filtered mode", () => {
	it("passes tagId through to listNotesPage", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({tagId: "t1"});
		await flush();

		expect(listNotesPage).toHaveBeenCalledWith(expect.objectContaining({tagId: "t1"}));
	});

	it("resolves and displays the tag's name in the heading, since there's no GET /tags/{id}", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({tagId: "t1"});
		await flush();

		expect(listTags).toHaveBeenCalledOnce();
		expect(document.querySelector(".notes-list-heading").textContent).toContain("recipes");
	});

	it("falls back if the tag id doesn't match any known tag", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({tagId: "unknown-id"});
		await flush();

		expect(document.querySelector(".notes-list-heading")).not.toBeNull();
	});

	it("uses the active-notes row actions (Delete), not the trash actions", async () => {
		listNotesPage.mockResolvedValue({notes: [{id: "n1", title: "Tagged note"}], nextCursor: null});
		await renderNotesList({tagId: "t1"});
		await flush();

		const actions = [...document.querySelectorAll(".notes-list-action")].map((b) => b.textContent);
		expect(actions).toEqual(["Delete"]);
	});

	it("shows a tag-specific empty message", async () => {
		listNotesPage.mockResolvedValue({notes: [], nextCursor: null});
		await renderNotesList({tagId: "t1"});
		await flush();

		expect(document.querySelector(".notes-list-status").textContent).toContain("No notes with this tag");
	});
});

describe("renderNotesList cleanup", () => {
	it("cleanup prevents a stale fetch from writing into the DOM", async () => {
		let resolvePage;
		listNotesPage.mockReturnValue(new Promise((r) => (resolvePage = r)));

		const cleanup = await renderNotesList({trashMode: false});
		cleanup(); // navigate away before the fetch resolves

		resolvePage({notes: [{id: "n1", title: "Late"}], nextCursor: null});
		await flush();

		expect(document.querySelector(".notes-list-row")).toBeNull();
	});
});
