import {describe, expect, it} from "vitest";
import {
	computeConnectionCounts,
	connectionCountRadius,
	focusedRadii,
	computeRadii,
	isNeighbour,
	shouldShowLabel,
	wrapTitleLines,
	DEFAULT_MIN_RADIUS,
	DEFAULT_MAX_RADIUS,
	FOCUSED_MIN_RADIUS,
	FOCUSED_MAX_RADIUS,
	FOCUSED_NODE_RADIUS,
	LABEL_RADIUS_THRESHOLD,
	LABEL_MAX_CHARS_PER_LINE,
	LABEL_MAX_LINES,
} from "./graph-sizing.js";

const nodes = [{id: "a"}, {id: "b"}, {id: "c"}, {id: "d"}];
const edges = [
	{source: "a", target: "b", similarity_score: 0.9},
	{source: "a", target: "c", similarity_score: 0.3},
	{source: "b", target: "c", similarity_score: 0.5},
];

describe("computeConnectionCounts", () => {
	it("counts edges touching each node from either side", () => {
		const counts = computeConnectionCounts(nodes, edges);
		expect(counts.get("a")).toBe(2); // a-b, a-c
		expect(counts.get("b")).toBe(2); // a-b, b-c
		expect(counts.get("c")).toBe(2); // a-c, b-c
		expect(counts.get("d")).toBe(0); // isolated
	});
});

describe("connectionCountRadius default (nothing focused) sizing", () => {
	it("gives an isolated node the minimum radius", () => {
		const counts = computeConnectionCounts(nodes, edges);
		const radiusFor = connectionCountRadius(counts);
		expect(radiusFor("d")).toBe(DEFAULT_MIN_RADIUS);
	});

	it("gives the most-connected node the maximum radius", () => {
		const counts = computeConnectionCounts(nodes, edges);
		const radiusFor = connectionCountRadius(counts);
		// a, b, c are tied at 2 (the max here), so all should hit the ceiling.
		expect(radiusFor("a")).toBeCloseTo(DEFAULT_MAX_RADIUS);
	});

	it("stays within the subtle default range for every node", () => {
		const counts = computeConnectionCounts(nodes, edges);
		const radiusFor = connectionCountRadius(counts);
		for (const node of nodes) {
			const r = radiusFor(node.id);
			expect(r).toBeGreaterThanOrEqual(DEFAULT_MIN_RADIUS);
			expect(r).toBeLessThanOrEqual(DEFAULT_MAX_RADIUS);
		}
	});

	it("does not divide by zero when there are no edges at all", () => {
		const counts = computeConnectionCounts(nodes, []);
		const radiusFor = connectionCountRadius(counts);
		expect(radiusFor("a")).toBe(DEFAULT_MIN_RADIUS);
		expect(Number.isFinite(radiusFor("a"))).toBe(true);
	});
});

describe("focusedRadii a node is focused (hover or keyboard)", () => {
	it("gives the focused node itself a fixed size, not similarity-based", () => {
		const radii = focusedRadii(nodes, edges, "a");
		expect(radii.get("a")).toBe(FOCUSED_NODE_RADIUS);
	});

	it("sizes a connected neighbour proportional to its similarity_score", () => {
		const radii = focusedRadii(nodes, edges, "a");
		const bRadius = radii.get("b");
		const cRadius = radii.get("c");
		expect(bRadius).toBeGreaterThan(cRadius);
		expect(bRadius).toBeLessThanOrEqual(FOCUSED_MAX_RADIUS);
		expect(cRadius).toBeGreaterThanOrEqual(FOCUSED_MIN_RADIUS);
	});

	it("gives a node with no confirmed edge to the focused node the minimum radius, never smaller", () => {
		const radii = focusedRadii(nodes, edges, "a");
		expect(radii.get("d")).toBe(FOCUSED_MIN_RADIUS);
	});

	it("checks both edge directions", () => {
		const radii = focusedRadii(nodes, edges, "a");
		expect(radii.get("b")).toBeGreaterThan(FOCUSED_MIN_RADIUS);
		expect(radii.get("c")).toBeGreaterThan(FOCUSED_MIN_RADIUS);
	});

	it("clamps an out-of-range similarity_score rather than producing a radius outside the intended band", () => {
		const weirdEdges = [{source: "a", target: "b", similarity_score: 5}];
		const radii = focusedRadii(nodes, weirdEdges, "a");
		expect(radii.get("b")).toBe(FOCUSED_MAX_RADIUS);
	});

	it("treats a missing similarity_score as 0 rather than throwing", () => {
		const edgesNoScore = [{source: "a", target: "b", similarity_score: null}];
		const radii = focusedRadii(nodes, edgesNoScore, "a");
		expect(radii.get("b")).toBe(FOCUSED_MIN_RADIUS);
	});
});

describe("computeRadii entry points", () => {
	it("delegates to the default connection-count sizing when nothing is focused", () => {
		const radii = computeRadii(nodes, edges, null);
		expect(radii.get("d")).toBe(DEFAULT_MIN_RADIUS);
	});

	it("delegates to focused sizing when a node id is given", () => {
		const radii = computeRadii(nodes, edges, "a");
		expect(radii.get("a")).toBe(FOCUSED_NODE_RADIUS);
	});
});

describe("isNeighbour", () => {
	it("is true for a directly linked node in either edge direction", () => {
		expect(isNeighbour(edges, "a", "b")).toBe(true);
		expect(isNeighbour(edges, "b", "a")).toBe(true);
	});

	it("is false for a node with no confirmed edge to the focused node", () => {
		expect(isNeighbour(edges, "a", "d")).toBe(false);
	});
});

describe("shouldShowLabel label visibility", () => {
	it("is false below the threshold", () => {
		expect(shouldShowLabel(DEFAULT_MIN_RADIUS)).toBe(false);
	});

	it("is true at or above the threshold", () => {
		expect(shouldShowLabel(DEFAULT_MAX_RADIUS)).toBe(true);
		expect(shouldShowLabel(LABEL_RADIUS_THRESHOLD)).toBe(true);
	});

	it("stays anchored to the default range's midpoint even for focused-state radii", () => {
		expect(shouldShowLabel(FOCUSED_MIN_RADIUS)).toBe(false);
		expect(shouldShowLabel(FOCUSED_MAX_RADIUS)).toBe(true);
	});
});

describe("wrapTitleLines", () => {
	it("returns a single line unchanged when it fits", () => {
		expect(wrapTitleLines("Short title")).toEqual(["Short title"]);
	});

	it("defaults to 'Untitled' for an empty/missing title", () => {
		expect(wrapTitleLines("")).toEqual(["Untitled"]);
		expect(wrapTitleLines(undefined)).toEqual(["Untitled"]);
	});

	it("wraps onto a second line at a word boundary rather than mid-word", () => {
		const lines = wrapTitleLines("Meeting notes from planning");
		expect(lines.length).toBeLessThanOrEqual(2);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(LABEL_MAX_CHARS_PER_LINE);
		}
	});

	it("truncates with an ellipsis on the final line once both lines are full", () => {
		const longTitle = "This is a genuinely extremly very long note title that will not fit in two lines";
		const lines = wrapTitleLines(longTitle);
		expect(lines).toHaveLength(2);
		expect(lines[1].endsWith("...")).toBe(true);
	});

	it("never exceeds LABEL_MAX_LINES", () => {
		const lines = wrapTitleLines("word ".repeat(30).trim());
		expect(lines.length).toBeLessThanOrEqual(LABEL_MAX_LINES);
	});

	it("hard-truncates a single word longer than one full line's budget", () => {
		const lines = wrapTitleLines("Supercalifragilisticexpialidocious");
		expect(lines[0].length).toBeLessThanOrEqual(LABEL_MAX_CHARS_PER_LINE);
	});

	it("splits a single very long unbroken token across both", () => {
		const lines = wrapTitleLines("A".repeat(40));
		expect(lines).toHaveLength(2);
		expect(lines[1].endsWith("...")).toBe(true);
	});

	it("never returns text longer than the total two-line character budget", () => {
		const exactlyBudget = "a".repeat(LABEL_MAX_CHARS_PER_LINE * LABEL_MAX_LINES);
		const lines = wrapTitleLines(exactlyBudget);
		expect(lines.join("").replace(/...$/, "").length).toBeLessThanOrEqual(
			LABEL_MAX_CHARS_PER_LINE * LABEL_MAX_LINES,
		);
	});
});
