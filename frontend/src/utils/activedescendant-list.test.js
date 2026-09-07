import {beforeEach, describe, expect, it, vi} from "vitest";
import {createActivedescendantList} from "./activedescendant-list.js";

function renderFixture() {
	document.body.innerHTML = `
		<input id="input" />
		<ul id="listbox">
			<li id="opt-0" role="option"></li>
			<li id="opt-1" role="option"></li>
			<li id="opt-2" role="option"></li>
		</ul>
	`;
}

function getOptionEls() {
	return Array.from(document.querySelectorAll('[role="option"]'));
}

beforeEach(() => {
	renderFixture();
});

describe("createActivedescendantList navigation", () => {
	it("ArrowDown moves to the first option from no selection", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.handleKey(new KeyboardEvent("keydown", {key: "ArrowDown", cancelable: true}));

		expect(document.getElementById("input").getAttribute("aria-activedescendant")).toBe("opt-0");
		expect(document.getElementById("opt-0").getAttribute("aria-selected")).toBe("true");
	});

	it("ArrowDown wraps from the last option back to the first", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.setActiveIndex(2);
		list.handleKey(new KeyboardEvent("keydown", {key: "ArrowDown", cancelable: true}));

		expect(document.getElementById("input").getAttribute("aria-activedescendant")).toBe("opt-0");
	});

	it("ArrowUp from the first option wraps to the last", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.setActiveIndex(0);
		list.handleKey(new KeyboardEvent("keydown", {key: "ArrowUp", cancelable: true}));

		expect(document.getElementById("input").getAttribute("aria-activedescendant")).toBe("opt-2");
	});

	it("ArrowUp from no selection lands one before the start, wrapping to the second-to-last option", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.handleKey(new KeyboardEvent("keydown", {key: "ArrowUp", cancelable: true}));
        
		expect(document.getElementById("input").getAttribute("aria-activedescendant")).toBe("opt-1");
	});

	it("Home jumps to the first option", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.setActiveIndex(2);
		list.handleKey(new KeyboardEvent("keydown", {key: "Home", cancelable: true}));

		expect(document.getElementById("input").getAttribute("aria-activedescendant")).toBe("opt-0");
	});

	it("End jumps to the last option", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.handleKey(new KeyboardEvent("keydown", {key: "End", cancelable: true}));

		expect(document.getElementById("input").getAttribute("aria-activedescendant")).toBe("opt-2");
	});

	it("only one option is aria-selected at a time", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.setActiveIndex(1);

		const selected = getOptionEls().filter((el) => el.getAttribute("aria-selected") === "true");
		expect(selected).toHaveLength(1);
		expect(selected[0].id).toBe("opt-1");
	});
});

describe("createActivedescendantList activation", () => {
	it("Enter activates the current option", () => {
		const onActivate = vi.fn();
		const list = createActivedescendantList({input: document.getElementById("input"), getOptionEls, onActivate});
		list.setActiveIndex(1);
		list.handleKey(new KeyboardEvent("keydown", {key: "Enter", cancelable: true}));

		expect(onActivate).toHaveBeenCalledWith(1);
	});

	it("Enter with no active option does nothing", () => {
		const onActivate = vi.fn();
		const list = createActivedescendantList({input: document.getElementById("input"), getOptionEls, onActivate});
		list.handleKey(new KeyboardEvent("keydown", {key: "Enter", cancelable: true}));

		expect(onActivate).not.toHaveBeenCalled();
	});

	it("keys it doesn't handle return false", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		const handled = list.handleKey(new KeyboardEvent("keydown", {key: "a", cancelable: true}));

		expect(handled).toBe(false);
	});
});

describe("createActivedescendantList empty list and reset", () => {
	it("setActiveIndex with no options clears aria-activedescendant", () => {
		document.getElementById("listbox").innerHTML = "";
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.setActiveIndex(0);

		expect(document.getElementById("input").hasAttribute("aria-activedescendant")).toBe(false);
	});

	it("resetActiveIndex clears the active option", () => {
		const list = createActivedescendantList({
			input: document.getElementById("input"),
			getOptionEls,
			onActivate: vi.fn(),
		});
		list.setActiveIndex(1);
		list.resetActiveIndex();

		expect(document.getElementById("input").hasAttribute("aria-activedescendant")).toBe(false);
	});
});
