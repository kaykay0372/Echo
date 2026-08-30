import {beforeEach, afterEach, describe, expect, it, vi} from "vitest";
import {installRealTemplates} from "../utils/install-real-templates.js";

vi.mock("../api/client.js", () => ({
	getGraph: vi.fn(),
}));
vi.mock("../components/nav.js", () => ({setNavCollapsed: vi.fn()}));

import {getGraph} from "../api/client.js";
import {renderGraph} from "./graph.js";

let cleanupFuncs = [];

function trackCleanup(cleanup) {
	cleanupFuncs.push(cleanup);
	return cleanup;
}

beforeEach(() => {
	document.body.innerHTML = `<main id="content" style="width:800px;height:600px;"></main>`;
	installRealTemplates();
	location.hash = "";
});

afterEach(() => {
	// Every test must stop its simulation's internal timer, or it keeps firing into the next test
	cleanupFuncs.forEach((func) => func?.());
	cleanupFuncs = [];
});

const nodeA = {id: "a", title: "Alpha", is_favourite: false};
const nodeB = {id: "b", title: "Beta", is_favourite: true};
const nodeC = {id: "c", title: "Gamma", is_favourite: false};

function twoLinkedOneNot() {
	return {
		nodes: [{...nodeA}, {...nodeB}, {...nodeC}],
		edges: [{source: "a", target: "b", link_type: "automatic", similarity_score: 0.8, status: "confirmed"}],
		stats: {total_notes: 3, total_links: 1, total_embeddings: 3},
	};
}

describe("renderGraph loading states", () => {
	it("shows an error message instead of throwing if the graph fails to load", async () => {
		getGraph.mockRejectedValue(new Error("network down"));
		trackCleanup(await renderGraph());
		expect(document.querySelector(".graph-error")).not.toBeNull();
	});

	it("shows an empty state for zero notes without touching D3", async () => {
		getGraph.mockResolvedValue({
			nodes: [],
			edges: [],
			stats: {total_notes: 0, total_links: 0, total_embeddings: 0},
		});
		trackCleanup(await renderGraph());
		expect(document.querySelector(".graph-empty")).not.toBeNull();
	});

	it("displays the stats from the API response", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());
		const statsText = document.querySelector(".graph-stats").textContent;
		expect(statsText).toContain("3 notes");
		expect(statsText).toContain("1 links");
		expect(statsText).toContain("3 embedded");
	});

	it("includes a link back to the list view", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());
		const link = document.querySelector(".graph-list-view-link");
		expect(link.getAttribute("href")).toBe("#/list");
	});
});

describe("renderGraph rendering nodes and edges", () => {
	it("renders one circle per node and one line per confirmed edge", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());
		expect(document.querySelectorAll(".graph-node")).toHaveLength(3);
		expect(document.querySelectorAll(".graph-edge")).toHaveLength(1);
	});

	it("gives every node an accessible name via aria-label, including favourite status", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());
		const circles = [...document.querySelectorAll(".graph-node")];
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));
		expect(beta.getAttribute("aria-label")).toContain("favourite");
	});
});

describe("renderGraph click navigates to the note", () => {
	it("clicking a node sets location.hash to that note's editor route", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		alpha.dispatchEvent(new MouseEvent("click", {bubbles: true}));

		expect(location.hash).toBe("#/note/a");
	});
});

describe("renderGraph keyboard navigation", () => {
	it("exactly one node starts with tabindex=0, the rest are -1", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const zeroTabIndex = circles.filter((c) => c.getAttribute("tabindex") === "0");
		expect(zeroTabIndex).toHaveLength(1);
	});

	it("ArrowRight moves roving focus to the next node in title order", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		// Title order: Alpha, Beta, Gamma - Alpha starts focused (tabindex 0).
		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));

		alpha.focus();
		alpha.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));

		expect(document.activeElement).toBe(beta);
		expect(beta.getAttribute("tabindex")).toBe("0");
		expect(alpha.getAttribute("tabindex")).toBe("-1");
	});

	it("ArrowLeft from the first node wraps around to the last", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		const gamma = circles.find((c) => c.getAttribute("aria-label")?.includes("Gamma"));

		alpha.focus();
		alpha.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));

		expect(document.activeElement).toBe(gamma);
	});

	it("Enter on a keyboard-focused node navigates to it, same as a click", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		alpha.focus();
		alpha.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));

		expect(location.hash).toBe("#/note/a");
	});
});

describe("renderGraph focus-driven similarity sizing (hover or keyboard)", () => {
	it("keyboard-focusing a node resizes its confirmed neighbour relative to similarity, and leaves the unlinked node at minimum size", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));
		const gamma = circles.find((c) => c.getAttribute("aria-label")?.includes("Gamma"));

		const betaRadiusBefore = Number(beta.getAttribute("r"));
		alpha.focus();
		alpha.dispatchEvent(new Event("focus"));

		const betaRadiusAfter = Number(beta.getAttribute("r"));
		const gammaRadiusAfter = Number(gamma.getAttribute("r"));

		expect(betaRadiusAfter).toBeGreaterThan(betaRadiusBefore);
		expect(betaRadiusAfter).toBeGreaterThan(gammaRadiusAfter);
		expect(beta.classList.contains("graph-node-neighbour")).toBe(true);
		expect(gamma.classList.contains("graph-node-neighbour")).toBe(false);
	});

	it("hovering a node has the same sizing effect as keyboard-focusing it", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));

		const before = Number(beta.getAttribute("r"));
		alpha.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));
		const after = Number(beta.getAttribute("r"));

		expect(after).toBeGreaterThan(before);
	});

	it("mouse leaving with no keyboard focus active reverts to the default connection-count sizing", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));

		const defaultRadius = Number(beta.getAttribute("r"));
		alpha.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));
		alpha.dispatchEvent(new MouseEvent("mouseleave", {bubbles: true}));

		expect(Number(beta.getAttribute("r"))).toBe(defaultRadius);
	});
});

describe("renderGraph node labels", () => {
	it("shows labels by default only for nodes above the size threshold, not every node", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const labels = [...document.querySelectorAll(".graph-label")];
		const alphaLabel = labels.find((l) => l.textContent === "Alpha");
		const betaLabel = labels.find((l) => l.textContent === "Beta");
		const gammaLabel = labels.find((l) => l.textContent === "Gamma");

		expect(alphaLabel.classList.contains("graph-label-visible")).toBe(true);
		expect(betaLabel.classList.contains("graph-label-visible")).toBe(true);
		expect(gammaLabel.classList.contains("graph-label-visible")).toBe(false);
	});

	it("truncates a long title rather than overflowing the graph with text", async () => {
		getGraph.mockResolvedValue({
			nodes: [{id: "a", title: "A".repeat(40)}],
			edges: [],
			stats: {},
		});
		trackCleanup(await renderGraph());
		const label = document.querySelector(".graph-label");
		expect(label.textContent.length).toBeLessThan(40);
		expect(label.textContent.endsWith("...")).toBe(true);
	});

	it("always shows the hovered/focused node's own label, even if it's below the size threshold", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const gamma = circles.find((c) => c.getAttribute("aria-label")?.includes("Gamma"));
		gamma.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));

		const gammaLabel = [...document.querySelectorAll(".graph-label")].find((l) => l.textContent === "Gamma");
		expect(gammaLabel.classList.contains("graph-label-visible")).toBe(true);
	});
});

describe("renderGraph detail panel (hover or keyboard focus)", () => {
	it("stays hidden when nothing is focused", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());
		expect(document.querySelector(".graph-detail-panel").hidden).toBe(true);
	});

	it("shows the full title, word count, favourite status and connection count on hover", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));
		beta.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));

		const panel = document.querySelector(".graph-detail-panel");
		expect(panel.hidden).toBe(false);
		expect(panel.querySelector(".graph-detail-panel-title").textContent).toBe("Beta");
		expect(panel.textContent).toContain("Favourite");
		expect(panel.textContent).toContain("1 connection");
	});

	it("hides again once the mouse leaves and nothing else is focused", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const beta = circles.find((c) => c.getAttribute("aria-label")?.includes("Beta"));
		beta.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));
		beta.dispatchEvent(new MouseEvent("mouseleave", {bubbles: true}));

		expect(document.querySelector(".graph-detail-panel").hidden).toBe(true);
	});

	it("also shows on keyboard focus, not just mouse hover", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		trackCleanup(await renderGraph());

		const circles = [...document.querySelectorAll(".graph-node")];
		const alpha = circles.find((c) => c.getAttribute("aria-label")?.includes("Alpha"));
		alpha.focus();
		alpha.dispatchEvent(new Event("focus"));

		const panel = document.querySelector(".graph-detail-panel");
		expect(panel.hidden).toBe(false);
		expect(panel.querySelector(".graph-detail-panel-title").textContent).toBe("Alpha");
	});
});

describe("renderGraph cleanup", () => {
	it("stops the force simulation on cleanup", async () => {
		getGraph.mockResolvedValue(twoLinkedOneNot());
		const cleanup = await renderGraph();
		expect(() => cleanup()).not.toThrow();
		cleanupFuncs = cleanupFuncs.filter((func) => func !== cleanup);
	});
});
