import {beforeEach, describe, expect, it, vi} from "vitest";
import {
	listNotes,
	listNotesPage,
	listFavouriteNotes,
	listTrashedNotes,
	listRecentNotes,
	searchNotes,
	createNote,
	getNote,
	updateNote,
	deleteNote,
	permanentlyDeleteNote,
	restoreNote,
	getNoteConnections,
	getNoteLinks,
	createAttachment,
	deleteAttachment,
	getAttachmentFileUrl,
	listTags,
	createTag,
	updateTag,
	deleteTag,
	assignTag,
	removeTag,
	getJobQueueStatus,
	retryJob,
	discardJob,
	deleteJob,
	getGraph,
	confirmLink,
	rejectLink,
} from "./client.js";

function mockNotesResponse(notes, nextCursor = null) {
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({notes, next_cursor: nextCursor}),
	});
}

beforeEach(() => {
	mockNotesResponse([]);
});

describe("listNotes with limited clamping", () => {
	it("passes limit through unchanged when within the server's cap", async () => {
		await listNotes({limit: 50});
		const calledUrl = global.fetch.mock.calls[0][0];
		expect(calledUrl).toContain("limit=50");
	});

	it("clamps to 200 and warns when limit exceeds the server's cap", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await listNotes({limit: 1000});

		const calledUrl = global.fetch.mock.calls[0][0];
		expect(calledUrl).toContain("limit=200");
		expect(calledUrl).not.toContain("limit=1000");
		expect(warnSpy).toHaveBeenCalledOnce();

		warnSpy.mockRestore();
	});
});

describe("listNotes response shape", () => {
	it("unwraps the notes array from { notes, next_cursor }", async () => {
		mockNotesResponse([{id: "1", title: "A"}], null);

		const notes = await listNotes();
		expect(notes).toEqual([{id: "1", title: "A"}]);
	});

	it("throws a clear error rather than silently returning wrong data for an unrecognised shape", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({items: [{id: "1"}]}), // stale guess
		});

		await expect(listNotes()).rejects.toThrow(/response shape/);
	});

	it("listNotesPage exposes next_cursor as nextCursor for pagination", async () => {
		mockNotesResponse([{id: "1"}], "2026-01-01T00:00:00.000Z_1");

		const {notes, nextCursor} = await listNotesPage({limit: 1});
		expect(notes).toEqual([{id: "1"}]);
		expect(nextCursor).toBe("2026-01-01T00:00:00.000Z_1");
	});
});

describe("listFavouriteNotes / listTrashedNotes server-side filters", () => {
	it("listFavouriteNotes requests favourite=true instead of filtering client-side", async () => {
		mockNotesResponse([{id: "1", is_favourite: true}]);

		const favourites = await listFavouriteNotes();

		const calledUrl = global.fetch.mock.calls[0][0];
		expect(calledUrl).toContain("favourite=true");
		expect(favourites).toEqual([{id: "1", is_favourite: true}]);
	});

	it("listTrashedNotes requests deleted_only=true instead of filtering client-side", async () => {
		mockNotesResponse([{id: "1", is_deleted: true}]);

		const trashed = await listTrashedNotes();

		const calledUrl = global.fetch.mock.calls[0][0];
		expect(calledUrl).toContain("deleted_only=true");
		expect(trashed).toEqual([{id: "1", is_deleted: true}]);
	});
});

describe("searchNotes substring match on content (server) + tags (client)", () => {
	it("returns [] without hitting the network for an empty query", async () => {
		const results = await searchNotes("   ");
		expect(results).toEqual([]);
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("merges title/body matches with tag-name matches, de-duplicated by id", async () => {
		let call = 0;
		global.fetch = vi.fn().mockImplementation((url) => {
			call += 1;
			// 1st call: the content-match request.
			// 2nd call: full fetch, filtered.
			if (call === 1) {
				return Promise.resolve({
					ok: true,
					status: 200,
					json: async () => ({
						notes: [{id: "1", title: "Recipe ideas", tags: []}],
						next_cursor: null,
					}),
				});
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				json: async () => ({
					notes: [
						{id: "1", title: "Recipe ideas", tags: []},
						{id: "2", title: "Unrelated", tags: [{id: "t1", name: "recipes"}]},
					],
					next_cursor: null,
				}),
			});
		});

		const results = await searchNotes("recipe");
		const ids = results.map((n) => n.id).sort();
		expect(ids).toEqual(["1", "2"]);
	});
});

describe("thin CRUD wrappers with correct URL, method, and body", () => {
	function mockOk(body = {}) {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => body,
		});
	}

	function mockNoContent() {
		global.fetch = vi.fn().mockResolvedValue({ok: true, status: 204});
	}

	it.each([
		["getNote", "/notes/n1", "GET", () => getNote("n1")],
		["updateNote", "/notes/n1", "PATCH", () => updateNote("n1", {title: "x"})],
		["deleteNote", "/notes/n1", "DELETE", () => deleteNote("n1")],
		["permanentlyDeleteNote", "/notes/n1/permanent", "DELETE", () => permanentlyDeleteNote("n1")],
		["restoreNote", "/notes/n1/restore", "POST", () => restoreNote("n1")],
		["getNoteConnections", "/notes/n1/connections?limit=5", "GET", () => getNoteConnections("n1")],
		["getNoteLinks", "/notes/n1/links", "GET", () => getNoteLinks("n1")],
		["deleteAttachment", "/notes/n1/attachments/a1", "DELETE", () => deleteAttachment("n1", "a1")],
		["listTags", "/tags", "GET", () => listTags()],
		["updateTag", "/tags/t1", "PATCH", () => updateTag("t1", {name: "x"})],
		["deleteTag", "/tags/t1", "DELETE", () => deleteTag("t1")],
		["assignTag", "/notes/n1/tags", "POST", () => assignTag("n1", "t1")],
		["removeTag", "/notes/n1/tags/t1", "DELETE", () => removeTag("n1", "t1")],
		["getJobQueueStatus", "/jobs?limit=50", "GET", () => getJobQueueStatus()],
		["retryJob", "/jobs/j1/retry", "POST", () => retryJob("j1")],
		["discardJob", "/jobs/j1/discard", "POST", () => discardJob("j1")],
		["deleteJob", "/jobs/j1", "DELETE", () => deleteJob("j1")],
		["getGraph", "/graph", "GET", () => getGraph()],
		["confirmLink", "/links/l1/confirm", "POST", () => confirmLink("l1")],
		["rejectLink", "/links/l1/reject", "POST", () => rejectLink("l1")],
		["listRecentNotes", "/notes?limit=5", "GET", () => listRecentNotes(5)],
	])("%s returns %s with %s", async (name, expectedPath, expectedMethod, call) => {
		if (name === "listRecentNotes") {
			mockOk({notes: [], next_cursor: null});
		} else {
			mockOk({});
		}
		await call();

		const [url, options] = global.fetch.mock.calls[0];
		expect(url).toBe(`http://127.0.0.1:8000${expectedPath}`);
		expect(options?.method ?? "GET").toBe(expectedMethod);
	});

	it("createNote POSTs to /notes with the payload as the JSON body", async () => {
		mockOk({id: "n1"});
		await createNote({title: "New", note_type: "text"});

		const [url, options] = global.fetch.mock.calls[0];
		expect(url).toBe("http://127.0.0.1:8000/notes");
		expect(options.method).toBe("POST");
		expect(JSON.parse(options.body)).toEqual({title: "New", note_type: "text"});
	});

	it("createTag sends name and parentId as parent_id in the body", async () => {
		mockOk({id: "t1"});
		await createTag({name: "urgent", parentId: "p1"});

		const [, options] = global.fetch.mock.calls[0];
		const body = JSON.parse(options.body);
		expect(body.name).toBe("urgent");
		expect(body.parent_id).toBe("p1");
	});

	it("deleteTag handles a 204 No Content response without throwing", async () => {
		mockNoContent();
		await expect(deleteTag("t1")).resolves.toBeNull();
	});

	it("createAttachment uploads via FormData, not JSON", async () => {
		mockOk({id: "a1"});
		const file = new File(["data"], "photo.png", {type: "image/png"});

		await createAttachment("n1", file);

		const [url, options] = global.fetch.mock.calls[0];
		expect(url).toBe("http://127.0.0.1:8000/notes/n1/attachments");
		expect(options.method).toBe("POST");
		expect(options.body).toBeInstanceOf(FormData);
	});

	it("createAttachment surfaces a duplicate-content conflict distinctly, with the existing note id", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 409,
			statusText: "Conflict",
			json: async () => ({
				error: "duplicate_content",
				detail: "An attachment with this content already exists",
				existing_note_id: "n-other",
			}),
		});
		const file = new File(["data"], "photo.png", {type: "image/png"});

		await expect(createAttachment("n1", file)).rejects.toMatchObject({
			status: 409,
			existingNoteId: "n-other",
		});
	});

	it("createAttachment on a generic failure has no existingNoteId set", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			json: async () => ({error: "internal_error", detail: "something broke"}),
		});
		const file = new File(["data"], "photo.png", {type: "image/png"});

		await expect(createAttachment("n1", file)).rejects.toMatchObject({
			status: 500,
			existingNoteId: null,
		});
	});

	it("createAttachment falls back if the error body isn't JSON", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 502,
			statusText: "Bad Gateway",
			json: async () => {
				throw new Error("not json");
			},
		});
		const file = new File(["data"], "photo.png", {type: "image/png"});

		await expect(createAttachment("n1", file)).rejects.toMatchObject({status: 502});
	});

	it("getAttachmentFileUrl builds the URL without making a request", () => {
		global.fetch = vi.fn();

		const url = getAttachmentFileUrl("a1");

		expect(url).toBe("http://127.0.0.1:8000/attachments/a1/file");
		expect(global.fetch).not.toHaveBeenCalled();
	});
});
