import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../api/client.js", () => ({
	listTags: vi.fn(),
	createTag: vi.fn(),
	assignTag: vi.fn(),
	removeTag: vi.fn(),
}));

import {listTags, createTag, assignTag, removeTag} from "../api/client.js";
import {renderTagsField} from "./tags-field.js";

let container;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	vi.clearAllMocks();
	listTags.mockResolvedValue([
		{id: "t1", name: "recipes"},
		{id: "t2", name: "reference"},
	]);
});

describe("renderTagsField note not saved yet", () => {
	it("shows a placeholder and does not render an add button when noteId is null", () => {
		renderTagsField(container, null, []);
		expect(container.textContent).toContain("Save the note");
		expect(container.querySelector(".tags-field-add-btn")).toBeNull();
	});
});

describe("renderTagsField existing note", () => {
	it("renders a chip per assigned tag", () => {
		renderTagsField(container, "n1", [{id: "t3", name: "urgent"}]);
		const chips = container.querySelectorAll(".tag-chip");
		expect(chips).toHaveLength(1);
		expect(chips[0].textContent).toContain("urgent");
	});

	it("removing a chip calls removeTag and re-renders without it", async () => {
		removeTag.mockResolvedValue();
		renderTagsField(container, "n1", [{id: "t3", name: "urgent"}]);

		container.querySelector(".tag-chip-remove").click();
		await new Promise((r) => setTimeout(r, 0));

		expect(removeTag).toHaveBeenCalledWith("n1", "t3");
		expect(container.querySelectorAll(".tag-chip")).toHaveLength(0);
	});

	it("clicking + Add opens a search popover populated from listTags, excluding already-assigned tags", async () => {
		renderTagsField(container, "n1", [{id: "t1", name: "recipes"}]);

		container.querySelector(".tags-field-add-btn").click();
		await new Promise((r) => setTimeout(r, 0));

		expect(listTags).toHaveBeenCalledOnce();
		const options = [...container.querySelectorAll(".tags-field-option")].map((o) => o.textContent);
		expect(options).toContain("reference");
		expect(options).not.toContain("recipes");
	});

	it("selecting an existing tag from the popover assigns it and adds a chip", async () => {
		assignTag.mockResolvedValue();
		renderTagsField(container, "n1", []);

		container.querySelector(".tags-field-add-btn").click();
		await new Promise((r) => setTimeout(r, 0));
		container.querySelector(".tags-field-option").click();
		await new Promise((r) => setTimeout(r, 0));

		expect(assignTag).toHaveBeenCalledWith("n1", "t1");
		expect(container.querySelector(".tag-chip")?.textContent).toContain("recipes");
	});

	it("typing a name with no exact match offers a Create option, which creates and assigns", async () => {
		createTag.mockResolvedValue({id: "t9", name: "brand-new"});
		assignTag.mockResolvedValue();
		renderTagsField(container, "n1", []);

		container.querySelector(".tags-field-add-btn").click();
		await new Promise((r) => setTimeout(r, 0));

		const input = container.querySelector(".tags-field-input");
		input.value = "brand-new";
		input.dispatchEvent(new Event("input"));

		const createOption = container.querySelector(".tags-field-option-create");
		expect(createOption.textContent).toContain("brand-new");

		createOption.click();
		await new Promise((r) => setTimeout(r, 0));

		expect(createTag).toHaveBeenCalledWith({name: "brand-new"});
		expect(assignTag).toHaveBeenCalledWith("n1", "t9");
		expect(container.querySelector(".tag-chip")?.textContent).toContain("brand-new");
	});

	it("Escape closes the popover without assigning anything", async () => {
		renderTagsField(container, "n1", []);

		container.querySelector(".tags-field-add-btn").click();
		await new Promise((r) => setTimeout(r, 0));

		const input = container.querySelector(".tags-field-input");
		input.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));

		expect(container.querySelector(".tags-field-popover")).toBeNull();
		expect(assignTag).not.toHaveBeenCalled();
	});

	it("cleanup empties the container", () => {
		const cleanup = renderTagsField(container, "n1", []);
		cleanup();
		expect(container.innerHTML).toBe("");
	});
});
