export const DEFAULT_MIN_RADIUS = 10;
export const DEFAULT_MAX_RADIUS = 15;
export const FOCUSED_MIN_RADIUS = 8;
export const FOCUSED_MAX_RADIUS = 24;
export const FOCUSED_NODE_RADIUS = 12;

export function computeConnectionCounts(nodes, edges) {
	const counts = new Map(nodes.map((n) => [n.id, 0]));
	for (const edge of edges) {
		if (counts.has(edge.source)) counts.set(edge.source, counts.get(edge.source) + 1);
		if (counts.has(edge.target)) counts.set(edge.target, counts.get(edge.target) + 1);
	}
	return counts;
}

// Default (nothing focused) sizing
export function connectionCountRadius(connectionCounts) {
	const maxCount = Math.max(1, ...connectionCounts.values());
	return function radiusFor(nodeId) {
		const count = connectionCounts.get(nodeId) ?? 0;
		const t = Math.sqrt(count / maxCount); // 0..1, compressed
		return DEFAULT_MIN_RADIUS + t * (DEFAULT_MAX_RADIUS - DEFAULT_MIN_RADIUS);
	};
}

// Builds a nodeId - radius map for the node focused state.
// - The focused node itself: fixed size, not similarity-based
// - A node with a confirmed edge to the focused node: sized by that
//   edge's similarity_score
// - A node with no confirmed edge to the focused node: minimum size
export function focusedRadii(nodes, edges, focusedNodeId) {
	const similarityByNeighbour = new Map();
	for (const edge of edges) {
		if (edge.source === focusedNodeId) {
			similarityByNeighbour.set(edge.target, edge.similarity_score ?? 0);
		} else if (edge.target === focusedNodeId) {
			similarityByNeighbour.set(edge.source, edge.similarity_score ?? 0);
		}
	}

	const radii = new Map();
	for (const node of nodes) {
		if (node.id === focusedNodeId) {
			radii.set(node.id, FOCUSED_NODE_RADIUS);
			continue;
		}
		const similarity = similarityByNeighbour.get(node.id);
		if (similarity == null) {
			radii.set(node.id, FOCUSED_MIN_RADIUS);
		} else {
			const clamped = Math.max(0, Math.min(1, similarity));
			radii.set(node.id, FOCUSED_MIN_RADIUS + clamped * (FOCUSED_MAX_RADIUS - FOCUSED_MIN_RADIUS));
		}
	}
	return radii;
}

// Single entry point graph.js calls on every focus change
export function computeRadii(nodes, edges, focusedNodeId) {
	if (focusedNodeId == null) {
		const radiusFor = connectionCountRadius(computeConnectionCounts(nodes, edges));
		return new Map(nodes.map((n) => [n.id, radiusFor(n.id)]));
	}
	return focusedRadii(nodes, edges, focusedNodeId);
}

export const LABEL_RADIUS_THRESHOLD = (DEFAULT_MIN_RADIUS + DEFAULT_MAX_RADIUS) / 2;

export function shouldShowLabel(radius) {
	return radius >= LABEL_RADIUS_THRESHOLD;
}

// Let title expand to two lines
export const LABEL_MAX_CHARS_PER_LINE = 19;
export const LABEL_MAX_LINES = 2;

export function wrapTitleLines(title) {
	const original = (title || "Untitled").trim();
	const totalBudget = LABEL_MAX_CHARS_PER_LINE * LABEL_MAX_LINES;
	const truncatedByBudget = original.length > totalBudget;
	const text = truncatedByBudget ? original.slice(0, totalBudget) : original;
	const words = text.split(/\s+/).filter(Boolean);

	let lines;
	let lostContent; // true if wrapping itself had to drop something wrapTitleLines was given

	if (words.length <= 1) {
		lines = [];
		for (let i = 0; i < text.length && lines.length < LABEL_MAX_LINES; i += LABEL_MAX_CHARS_PER_LINE) {
			lines.push(text.slice(i, i + LABEL_MAX_CHARS_PER_LINE));
		}
		if (!lines.length) lines = [text];
		lostContent = lines.join("").length < text.length;
	} else {
		lines = [];
		let current = "";
		lostContent = false;

		for (const word of words) {
			if (lines.length >= LABEL_MAX_LINES) {
				lostContent = true;
				break;
			}

			const candidate = current ? `${current} ${word}` : word;
			if (candidate.length <= LABEL_MAX_CHARS_PER_LINE) {
				current = candidate;
				continue;
			}

			if (current) {
				lines.push(current);
				current = "";
			}
			if (lines.length >= LABEL_MAX_LINES) {
				lostContent = true;
				break;
			}

			// Edge-case to handle a single word longer than a whole line's budget
			if (word.length > LABEL_MAX_CHARS_PER_LINE) {
				current = word.slice(0, LABEL_MAX_CHARS_PER_LINE);
				lostContent = true;
			} else {
				current = word;
			}
		}

		if (current) {
			if (lines.length < LABEL_MAX_LINES) {
				lines.push(current);
			} else {
				lostContent = true;
			}
		}
	}

	if ((truncatedByBudget || lostContent) && lines.length > 0) {
		const lastIndex = lines.length - 1;
		const maxLastLineLen = LABEL_MAX_CHARS_PER_LINE - 3;
		const lastLine = lines[lastIndex].slice(0, Math.max(0, maxLastLineLen));
		lines[lastIndex] = lastLine + "...";
	}

	return lines;
}

export function isNeighbour(edges, focusedNodeId, nodeId) {
	return edges.some(
		(e) =>
			(e.source === focusedNodeId && e.target === nodeId) || (e.target === focusedNodeId && e.source === nodeId),
	);
}
