import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../api/client.js", () => ({
	searchNotes: vi.fn(),
}));

import {searchNotes} from "../api/client.js";
import {initSearch} from "./search.js";

beforeEach(() => {
	document.body.innerHTML = `
		<div class="titlebar-search">
			<input id="global-search" type="search" />
			<ul id="search-results" hidden></ul>
		</div>
	`;
	vi.clearAllMocks();
	vi.useFakeTimers();
	initSearch();
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

function input() {
	return document.getElementById("global-search");
}
function results() {
	return document.getElementById("search-results");
}

function type(value) {
	input().value = value;
	input().dispatchEvent(new Event("input"));
}

describe("initSearch does nothing if the DOM isn't there", () => {
	it("does not throw when #global-search or #search-results is missing", () => {
		document.body.innerHTML = "";
		expect(() => initSearch()).not.toThrow();
	});
});

describe("initSearch debounced querying", () => {
	it("does not call searchNotes until the debounce elapses", async () => {
		searchNotes.mockResolvedValue([]);
		type("recipe");
		expect(searchNotes).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(250);
		expect(searchNotes).toHaveBeenCalledWith("recipe");
	});

	it("clears results immediately (no debounce) when the query is emptied", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: "Recipe"}]);
		type("recipe");
		await vi.advanceTimersByTimeAsync(250);
		expect(results().hidden).toBe(false);

		type("");
		expect(results().hidden).toBe(true);
	});

	it("trims whitespace before searching", async () => {
		type("   recipe   ");
		await vi.advanceTimersByTimeAsync(250);
		expect(searchNotes).toHaveBeenCalledWith("recipe");
	});
});

describe("initSearch rendering results", () => {
	it("renders one link per result, pointing at the note route", async () => {
		searchNotes.mockResolvedValue([
			{id: "n1", title: "First note"},
			{id: "n2", title: "Second note"},
		]);
		type("note");
		await vi.advanceTimersByTimeAsync(250);

		const links = results().querySelectorAll(".search-results-item");
		expect(links).toHaveLength(2);
		expect(links[0].getAttribute("href")).toBe("#/note/n1");
		expect(links[0].textContent).toBe("First note");
	});

	it("falls back to 'Untitled' for a note with no title", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: ""}]);
		type("x");
		await vi.advanceTimersByTimeAsync(250);
		expect(results().querySelector(".search-results-item").textContent).toBe("Untitled");
	});

	it("shows an empty-state message when nothing matches", async () => {
		searchNotes.mockResolvedValue([]);
		type("nonexistent");
		await vi.advanceTimersByTimeAsync(250);
		expect(results().querySelector(".search-results-empty").textContent).toContain("nonexistent");
	});

	it("sets aria-expanded true once results are shown, false once closed", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: "x"}]);
		type("x");
		await vi.advanceTimersByTimeAsync(250);
		expect(input().getAttribute("aria-expanded")).toBe("true");

		type("");
		expect(input().getAttribute("aria-expanded")).toBe("false");
	});
});

describe("initSearch condition guard", () => {
	it("a slower response to an older query does not clobber a faster response to a newer one", async () => {
		let resolveFirst;
		searchNotes.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		type("first");
		await vi.advanceTimersByTimeAsync(250);

		searchNotes.mockResolvedValueOnce([{id: "n2", title: "Second query result"}]);
		type("second");
		await vi.advanceTimersByTimeAsync(250);

		// The stale first request resolves after the second already rendered.
		resolveFirst([{id: "n1", title: "First query result (stale)"}]);
		await Promise.resolve();
		await Promise.resolve();

		expect(results().textContent).toContain("Second query result");
		expect(results().textContent).not.toContain("First query result");
	});
});

describe("initSearch dismissal", () => {
	it("Escape closes the results and blurs the input", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: "x"}]);
		type("x");
		await vi.advanceTimersByTimeAsync(250);
		input().focus();

		input().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));

		expect(results().hidden).toBe(true);
		expect(document.activeElement).not.toBe(input());
	});

	it("clicking a result closes the dropdown and clears the input", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: "Pick me"}]);
		type("pick");
		await vi.advanceTimersByTimeAsync(250);

		results().querySelector(".search-results-item").click();

		expect(results().hidden).toBe(true);
		expect(input().value).toBe("");
	});

	it("clicking outside the input and dropdown closes it", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: "x"}]);
		type("x");
		await vi.advanceTimersByTimeAsync(250);

		document.body.click();

		expect(results().hidden).toBe(true);
	});

	it("clicking inside the dropdown itself does not close it", async () => {
		searchNotes.mockResolvedValue([{id: "n1", title: "x"}]);
		type("x");
		await vi.advanceTimersByTimeAsync(250);

		results().click();

		expect(results().hidden).toBe(false);
	});
});

describe("initSearch failure handling", () => {
	it("logs and leaves results closed if searchNotes rejects", async () => {
		searchNotes.mockRejectedValue(new Error("network down"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		type("x");
		await vi.advanceTimersByTimeAsync(250);

		expect(results().hidden).toBe(true);
		expect(errorSpy).toHaveBeenCalled();
	});
});
