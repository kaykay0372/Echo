import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {initNav, setNavCollapsed} from "./nav.js";

// A minimal slice of index.html's real markup to test
function renderNavFixture() {
	document.body.innerHTML = `
		<nav id="nav">
		<button type="button" id="nav-pin-toggle" aria-pressed="false"></button>
		<div class="nav-section" data-section="recent">
			<button aria-expanded="true" aria-controls="list-recent" id="header-recent">
			<svg class="chevron"></svg>
			</button>
			<ul id="list-recent"><li>Note A</li></ul>
		</div>
		<div class="nav-section" data-section="tags">
			<button aria-expanded="false" aria-controls="list-tags" id="header-tags">
			<svg class="chevron"></svg>
			</button>
			<ul id="list-tags" hidden><li>Tag A</li></ul>
		</div>
		</nav>
	`;
}

describe("initNav tests", () => {
	beforeEach(() => {
		window.localStorage.clear();
		renderNavFixture();
		initNav();
	});

	it("starts each section matching its markup's aria-expanded state on first run", () => {
		const recentList = document.getElementById("list-recent");
		const tagsList = document.getElementById("list-tags");

		// Recent starts expanded in the fixture, must be visible.
		expect(recentList.hidden).toBe(false);
		// Tags starts collapsed in the fixture, must be hidden.
		expect(tagsList.hidden).toBe(true);
	});

	it("clicking an expanded section's header collapses it", () => {
		const header = document.getElementById("header-recent");
		const list = document.getElementById("list-recent");

		header.click();

		expect(header.getAttribute("aria-expanded")).toBe("false");
		expect(list.hidden).toBe(true);
	});

	it("clicking a collapsed section's header expands it", () => {
		const header = document.getElementById("header-tags");
		const list = document.getElementById("list-tags");

		header.click();

		expect(header.getAttribute("aria-expanded")).toBe("true");
		expect(list.hidden).toBe(false);
	});

	it("toggles the chevron's rotate-180 class to match expanded state", () => {
		const header = document.getElementById("header-recent");
		const chevron = header.querySelector(".chevron");

		// Recent starts expanded, so the chevron should start rotated.
		expect(chevron.classList.contains("rotate-180")).toBe(true);

		header.click(); // collapse it

		expect(chevron.classList.contains("rotate-180")).toBe(false);
	});

	it("remembers a section's collapsed state across an initNav() re-run", () => {
		const header = document.getElementById("header-recent");
		header.click(); // collapse Recent
		expect(header.getAttribute("aria-expanded")).toBe("false");

		// Simulate a reload
		renderNavFixture();
		initNav();

		const reloadedHeader = document.getElementById("header-recent");
		const reloadedList = document.getElementById("list-recent");
		expect(reloadedHeader.getAttribute("aria-expanded")).toBe("false");
		expect(reloadedList.hidden).toBe(true);
	});

	it("the All-tags link collapses together with the list, not separately", () => {
		document.body.innerHTML = `
			<nav id="nav">
				<div class="nav-section" data-section="tags">
				<button aria-expanded="true" aria-controls="tags-body-test" id="header-tags-test">
					<div class="nav-section-header-row">
					<span class="nav-section-label">Tags</span>
					<svg class="chevron"></svg>
					</div>
				</button>
				<div id="tags-body-test">
					<ul id="list-tags-test"><li>Tag A</li></ul>
					<a href="#/tags" class="nav-section-all-link">All tags</a>
				</div>
				</div>
			</nav>
		`;
		initNav();

		const header = document.getElementById("header-tags-test");
		const body = document.getElementById("tags-body-test");
		const link = body.querySelector(".nav-section-all-link");

		expect(body.hidden).toBe(false);
		header.click();

		expect(header.getAttribute("aria-expanded")).toBe("false");
		expect(body.hidden).toBe(true);
		// Confirming the link hides alongside the toggle content
		expect(link.offsetParent === null || body.hidden).toBe(true);
	});
});

describe("nav pin toggle tests", () => {
	beforeEach(() => {
		window.localStorage.clear();
		renderNavFixture();
		initNav();
	});

	it("starts unpinned by default", () => {
		expect(document.getElementById("nav").classList.contains("nav-pinned")).toBe(false);
		expect(document.getElementById("nav-pin-toggle").getAttribute("aria-pressed")).toBe("false");
	});

	it("clicking the pin toggle pins the nav open and sets aria-pressed", () => {
		document.getElementById("nav-pin-toggle").click();

		expect(document.getElementById("nav").classList.contains("nav-pinned")).toBe(true);
		expect(document.getElementById("nav-pin-toggle").getAttribute("aria-pressed")).toBe("true");
	});

	it("clicking the pin toggle twice unpins it again", () => {
		const pinToggle = document.getElementById("nav-pin-toggle");
		pinToggle.click();
		pinToggle.click();

		expect(document.getElementById("nav").classList.contains("nav-pinned")).toBe(false);
		expect(pinToggle.getAttribute("aria-pressed")).toBe("false");
	});

	it("remembers the pinned state across an initNav() re-run", () => {
		document.getElementById("nav-pin-toggle").click();

		renderNavFixture();
		initNav();

		expect(document.getElementById("nav").classList.contains("nav-pinned")).toBe(true);
		expect(document.getElementById("nav-pin-toggle").getAttribute("aria-pressed")).toBe("true");
	});

	it("blurs the toggle on unpin so lingering focus doesn't override mouse-leave collapse (bug)", () => {
		const pinToggle = document.getElementById("nav-pin-toggle");
		pinToggle.focus();
		pinToggle.click(); // pin
		expect(document.activeElement).toBe(pinToggle);

		pinToggle.click(); // unpin
		expect(document.activeElement).not.toBe(pinToggle);
	});
});

describe("setNavCollapsed tests", () => {
	beforeEach(() => {
		window.localStorage.clear();
		renderNavFixture();
	});

	it("adds the nav-collapsed class when collapsed is true", () => {
		setNavCollapsed(true);
		expect(document.getElementById("nav").classList.contains("nav-collapsed")).toBe(true);
	});

	it("removes the nav-collapsed class when collapsed is false", () => {
		setNavCollapsed(true);
		setNavCollapsed(false);
		expect(document.getElementById("nav").classList.contains("nav-collapsed")).toBe(false);
	});
});

describe("nav auto-collapse", () => {
	const originalWidth = window.innerWidth;

	afterEach(() => {
		window.innerWidth = originalWidth;
	});

	it("collapses the nav when the window is resized below the breakpoint, so content isn't squeezed", () => {
		window.localStorage.clear();
		renderNavFixture();
		initNav();
		expect(document.getElementById("nav").classList.contains("nav-collapsed")).toBe(false);

		window.innerWidth = 500;
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("nav").classList.contains("nav-collapsed")).toBe(true);
	});

	it("a narrow window overrides a manual pin", () => {
		window.localStorage.clear();
		renderNavFixture();
		initNav();
		document.getElementById("nav-pin-toggle").click(); // pin while wide

		window.innerWidth = 500;
		window.dispatchEvent(new Event("resize"));

		expect(document.getElementById("nav").classList.contains("nav-pinned")).toBe(false);
		expect(document.getElementById("nav").classList.contains("nav-collapsed")).toBe(true);
	});
});
