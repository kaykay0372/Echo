import {beforeEach, describe, expect, it, vi} from "vitest";
import {installRealTemplates} from "../utils/install-real-templates.js";

vi.mock("../api/client.js", () => ({
	listTags: vi.fn(),
	updateTag: vi.fn(),
	deleteTag: vi.fn(),
}));
vi.mock("../components/nav.js", () => ({setNavCollapsed: vi.fn()}));

import {listTags, updateTag, deleteTag} from "../api/client.js";
import {renderTags} from "./tags.js";

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = `<main id="content"></main>`;
	installRealTemplates();
});

async function flush() {
	/* Flush any pending promises, so that the DOM has been updated after async calls. */
	await Promise.resolve();
	await Promise.resolve();
}

describe("renderTags listing", () => {
	it("renders tags in whatever order listTags() returns (sorting is server-side now)", async () => {
		// Deliberately NOT alphabetical here
		listTags.mockResolvedValue([
			{id: "t2", name: "zebra"},
			{id: "t1", name: "apple"},
		]);
		await renderTags();
		await flush();

		const rows = [...document.querySelectorAll(".tags-page-link")].map((a) => a.textContent);
		expect(rows).toEqual(["zebra", "apple"]);
	});

	it("relies on the server's default sort (name, asc) rather than passing explicit params", async () => {
		listTags.mockResolvedValue([]);
		await renderTags();
		await flush();
		expect(listTags).toHaveBeenCalledWith();
	});

	it("each tag links to its filtered notes list", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		await renderTags();
		await flush();

		expect(document.querySelector(".tags-page-link").getAttribute("href")).toBe("#/tags/t1");
	});

	it("shows an empty state with no tags", async () => {
		listTags.mockResolvedValue([]);
		await renderTags();
		await flush();
		expect(document.querySelector(".tags-page-status").textContent).toContain("No tags yet");
	});
});

describe("renderTags renaming", () => {
	it("clicking Rename swaps the link for an editable input pre-filled with the current name", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		await renderTags();
		await flush();

		document.querySelector(".tags-page-action").click(); // Rename is the first action

		const input = document.querySelector(".tags-page-rename-input");
		expect(input).not.toBeNull();
		expect(input.value).toBe("recipes");
		expect(document.querySelector(".tags-page-link")).toBeNull();
	});

	it("blurring with a changed name calls updateTag and shows the new name", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		updateTag.mockResolvedValue({id: "t1", name: "recipies-fixed"});
		await renderTags();
		await flush();

		document.querySelector(".tags-page-action").click();
		const input = document.querySelector(".tags-page-rename-input");
		input.value = "recipies-fixed";
		input.dispatchEvent(new Event("blur"));
		await flush();

		expect(updateTag).toHaveBeenCalledWith("t1", {name: "recipies-fixed"});
		expect(document.querySelector(".tags-page-link").textContent).toBe("recipies-fixed");
	});

	it("blurring with an unchanged name does not call updateTag", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		await renderTags();
		await flush();

		document.querySelector(".tags-page-action").click();
		document.querySelector(".tags-page-rename-input").dispatchEvent(new Event("blur"));
		await flush();

		expect(updateTag).not.toHaveBeenCalled();
		expect(document.querySelector(".tags-page-link").textContent).toBe("recipes");
	});

	it("Esc reverts to the original name without saving", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		await renderTags();
		await flush();

		document.querySelector(".tags-page-action").click();
		const input = document.querySelector(".tags-page-rename-input");
		input.value = "typo-in-progress";
		//  Synthetic keyboard event
		input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
		await flush();

		expect(updateTag).not.toHaveBeenCalled();
		expect(document.querySelector(".tags-page-link").textContent).toBe("recipes");
	});
});

describe("renderTags deleting", () => {
	it("first click arms the confirmation without deleting", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		await renderTags();
		await flush();

		const deleteBtn = [...document.querySelectorAll(".tags-page-action")].find((b) => b.textContent === "Delete");
		deleteBtn.click();

		expect(deleteTag).not.toHaveBeenCalled();
		expect(deleteBtn.textContent).toBe("Confirm?");
	});

	it("second click actually deletes and removes the row", async () => {
		listTags.mockResolvedValue([{id: "t1", name: "recipes"}]);
		deleteTag.mockResolvedValue();
		await renderTags();
		await flush();

		const deleteBtn = [...document.querySelectorAll(".tags-page-action")].find((b) => b.textContent === "Delete");
		deleteBtn.click();
		deleteBtn.click();
		await flush();

		expect(deleteTag).toHaveBeenCalledWith("t1");
		expect(document.querySelector(".tags-page-row")).toBeNull();
	});
});
