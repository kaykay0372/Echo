const routes = [];

export function registerRoute(pattern, render) {
	/* Registers a handler for a route pattern. */
	const paramNames = [];
	const regexSource = pattern
		.split("/")
		.map((segment) => {
			if (segment.startsWith(":")) {
				paramNames.push(segment.slice(1));
				return "([^/]+)";
			}
			return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // literal segments match verbatim
		})
		.join("/");

	routes.push({regex: new RegExp(`^${regexSource}$`), paramNames, render});
}

let currentCleanup = null;
let navigationToken = 0;

function matchRoute(path) {
	/* Finds the matching route of a given path. */
	for (const route of routes) {
		const match = path.match(route.regex);
		if (!match) continue;
		const params = {};
		route.paramNames.forEach((name, i) => {
			params[name] = decodeURIComponent(match[i + 1]);
		});
		return {route, params};
	}
	return null;
}

async function handleHashChange() {
	/* Matches the current location.hash against registered routes and renders the matching one. */
	const path = (location.hash.slice(1) || "/").split("?")[0];
	const matched = matchRoute(path);
	const myToken = ++navigationToken;

	if (typeof currentCleanup === "function") {
		currentCleanup();
		currentCleanup = null;
	}

	if (!matched) {
		console.warn(`no route matched "${path}"`);
		return;
	}

	const cleanup = (await matched.route.render(matched.params)) || null;

	// A stale result is discarded if another navigation has taken over.
	if (myToken !== navigationToken) {
		if (typeof cleanup === "function") cleanup();
		return;
	}

	currentCleanup = cleanup;
}

export function initRouter() {
	/* Sets up hash-based client-side routing and renders the initial route. */
	window.addEventListener("hashchange", handleHashChange);
	handleHashChange(); // handle whatever's already in the URL on load
}

export function _navigateForTest(path) {
	/* Gives test functions a clean navigation listener without reloading the module. */
	location.hash = `#${path}`;
	return handleHashChange();
}
