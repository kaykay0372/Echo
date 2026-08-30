import * as d3 from "d3";
import {getGraph} from "../api/client.js";
import {setNavCollapsed} from "../components/nav.js";
import {computeRadii, isNeighbour, shouldShowLabel, wrapTitleLines} from "../components/graph-sizing.js";
import {mountTemplate} from "../utils/templates.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export async function renderGraph() {
	/* Parent function for the graph page. */

	const content = document.getElementById("content");
	setNavCollapsed(false);
	content.innerHTML = "";

	let data;
	try {
		data = await getGraph();
	} catch (err) {
		console.error("graph failed to load", err);
		content.innerHTML = `<p class="graph-error" role="alert">Couldn't load the graph.</p>`;
		return null;
	}

	const {nodes, edges, stats} = data;

	mountTemplate(content, "graph-template");
	content.querySelector('[data-stat="notes"]').textContent = `${stats?.total_notes ?? 0} notes`;
	content.querySelector('[data-stat="links"]').textContent = `${stats?.total_links ?? 0} links`;
	content.querySelector('[data-stat="embeddings"]').textContent = `${stats?.total_embeddings ?? 0} embedded`;
	const svgHost = content.querySelector(".graph-canvas");
	const liveRegion = content.querySelector("#graph-live-region");

	if (nodes.length === 0) {
		svgHost.innerHTML = `<p class="graph-empty">No notes to show yet.</p>`;
		return function cleanup() {};
	}

	// Sort by title so that keyboard navigation is predictable and consistent across pages
	const orderedIds = [...nodes].sort((a, b) => (a.title || "").localeCompare(b.title || "")).map((n) => n.id);

	const width = svgHost.clientWidth || 800;
	const height = svgHost.clientHeight || 600;

	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("class", "graph-svg");
	svg.setAttribute("role", "group");
	svg.setAttribute("aria-label", "Note graph: Use Tab to enter, arrow keys to move between notes, Enter to open one");
	svgHost.appendChild(svg);

	const d3svg = d3.select(svg);
	const zoomRoot = d3svg.append("g").attr("class", "graph-zoom-root");
	const edgeLayer = zoomRoot.append("g").attr("class", "graph-edges");
	const nodeLayer = zoomRoot.append("g").attr("class", "graph-nodes");
	const labelLayer = zoomRoot.append("g").attr("class", "graph-labels");
	const detailPanel = content.querySelector(".graph-detail-panel");

	// Pan and zoom.
	const zoomBehavior = d3
		.zoom()
		.scaleExtent([0.2, 4])
		.on("zoom", (event) => zoomRoot.attr("transform", event.transform));
	d3svg.call(zoomBehavior);

	// ! d3-force mutates edge.source/target from plain ids into direct node object references
	const edgesById = edges.map((e) => ({...e}));

	// Must exist before forceCollide() is created below.
	let currentRadii = computeRadii(nodes, edgesById, null);
	let hoveredId = null;
	let keyboardFocusedId = null;

	const simulation = d3
		.forceSimulation(nodes)
		.force(
			"link",
			d3
				.forceLink(edges)
				.id((d) => d.id)
				.distance(90),
		)
		.force("charge", d3.forceManyBody().strength(-180))
		.force("center", d3.forceCenter(width / 2, height / 2))
		.force(
			"collide",
			d3.forceCollide().radius((d) => currentRadii.get(d.id) ?? 12),
		);

	const edgeSelection = edgeLayer.selectAll("line").data(edges).join("line").attr("class", "graph-edge");

	const nodeSelection = nodeLayer
		.selectAll("circle")
		.data(nodes, (d) => d.id)
		.join("circle")
		.attr("class", "graph-node")
		.attr("r", (d) => currentRadii.get(d.id))
		.attr("tabindex", (d) => (d.id === orderedIds[0] ? "0" : "-1"))
		.attr("role", "button")
		.attr("aria-label", (d) => noteAriaLabel(d))
		.on("mouseenter", (event, d) => {
			hoveredId = d.id;
			updateFocusVisuals();
		})
		.on("mouseleave", () => {
			hoveredId = null;
			updateFocusVisuals();
		})
		.on("focus", (event, d) => {
			keyboardFocusedId = d.id;
			setRovingTabindex(d.id);
			updateFocusVisuals();
			announce(`Focused: ${noteAriaLabel(d)}`);
		})
		.on("blur", () => {
			keyboardFocusedId = null;
			updateFocusVisuals();
		})
		.on("click", (event, d) => navigateToNote(d.id))
		.on("keydown", (event, d) => handleNodeKeydown(event, d));

	// Node labels always present for screen readers, but only visible on focus
	const labelSelection = labelLayer
		.selectAll("text")
		.data(nodes, (d) => d.id)
		.join("text")
		.attr("class", "graph-label")
		.attr("aria-hidden", "true")
		.each(function (d) {
			const lines = wrapTitleLines(d.title);
			const text = d3.select(this);
			text.selectAll("tspan").remove();
			lines.forEach((line, i) => {
				text.append("tspan")
					.attr("class", "graph-label-line")
					.attr("x", 0)
					.attr("dy", i === 0 ? "0" : "1.1em")
					.text(line);
			});
		});

	function noteAriaLabel(d) {
		const parts = [d.title || "Untitled"];
		if (d.is_favourite) parts.push("favourite");
		return parts.join(", ");
	}

	function setRovingTabindex(activeId) {
		nodeSelection.attr("tabindex", (d) => (d.id === activeId ? "0" : "-1"));
	}

	function handleNodeKeydown(event, d) {
		const idx = orderedIds.indexOf(d.id);
		let targetId = null;

		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			navigateToNote(d.id);
			return;
		}
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			targetId = orderedIds[(idx + 1) % orderedIds.length];
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			targetId = orderedIds[(idx - 1 + orderedIds.length) % orderedIds.length];
		} else if (event.key === "Home") {
			targetId = orderedIds[0];
		} else if (event.key === "End") {
			targetId = orderedIds[orderedIds.length - 1];
		} else {
			return;
		}

		event.preventDefault();
		const targetEl = nodeSelection.filter((n) => n.id === targetId).node();
		targetEl?.focus();
	}

	function navigateToNote(noteId) {
		location.hash = `#/note/${noteId}`;
	}

	function announce(text) {
		if (liveRegion) liveRegion.textContent = text;
	}

	function updateFocusVisuals() {
		const activeId = keyboardFocusedId ?? hoveredId;
		currentRadii = computeRadii(nodes, edgesById, activeId);

		nodeSelection
			.attr("r", (d) => currentRadii.get(d.id))
			.classed("graph-node-focused", (d) => d.id === activeId)
			.classed(
				"graph-node-neighbour",
				(d) => activeId != null && d.id !== activeId && isNeighbour(edgesById, activeId, d.id),
			);

		// The active node always gets its label shown regardless of the size threshold.
		labelSelection.classed("graph-label-visible", (d) => {
			if (d.id === activeId) return true;
			return shouldShowLabel(currentRadii.get(d.id));
		});

		edgeSelection.classed("graph-edge-highlighted", (e) => {
			if (activeId == null) return false;
			const sourceId = typeof e.source === "object" ? e.source.id : e.source;
			const targetId = typeof e.target === "object" ? e.target.id : e.target;
			return sourceId === activeId || targetId === activeId;
		});

		updateDetailPanel(activeId);

		simulation.force("collide").radius((d) => currentRadii.get(d.id) ?? 12);
		simulation.alpha(0.1).restart();
	}

	// Fixed-position graph panel
	function updateDetailPanel(activeId) {
		if (!detailPanel) return;
		if (activeId == null) {
			detailPanel.hidden = true;
			detailPanel.innerHTML = "";
			return;
		}
		const node = nodes.find((n) => n.id === activeId);
		if (!node) return;

		detailPanel.hidden = false;
		detailPanel.innerHTML = "";

		const title = document.createElement("div");
		title.className = "graph-detail-panel-title";
		title.textContent = node.title || "Untitled";
		detailPanel.appendChild(title);

		const meta = document.createElement("div");
		meta.className = "graph-detail-panel-meta";
		const parts = [`${node.word_count ?? 0} words`];
		if (node.is_favourite) parts.push("Favourite");
		const connectionCount = edgesById.filter((e) => e.source === activeId || e.target === activeId).length;
		parts.push(`${connectionCount} connection${connectionCount === 1 ? "" : "s"}`);
		meta.textContent = parts.join(" | ");
		detailPanel.appendChild(meta);
	}

	simulation.on("tick", () => {
		edgeSelection
			.attr("x1", (d) => d.source.x)
			.attr("y1", (d) => d.source.y)
			.attr("x2", (d) => d.target.x)
			.attr("y2", (d) => d.target.y);

		nodeSelection.attr("cx", (d) => d.x).attr("cy", (d) => d.y);

		// tspan's x is absolute, so each line needs its x set explicitly
		labelSelection.each(function (d) {
			const text = d3.select(this);
			const y = d.y + currentRadii.get(d.id) + 10;
			text.selectAll(".graph-label-line").attr("x", d.x);
			text.select(".graph-label-line:first-child").attr("y", y);
		});
	});

	// Apply the initial (nothing-focused) label visibility and edge highlighting state.
	updateFocusVisuals();

	return function cleanup() {
		simulation.stop();
	};
}
