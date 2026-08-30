import {initTitlebar} from "./components/titlebar.js";
import {initNav, setNavCollapsed} from "./components/nav.js";
import {initGlobalShortcuts} from "./utils/keyboard-shortcuts.js";
import {initSearch} from "./components/search.js";
import {mountJobQueue} from "./components/job-queue.js";
import {registerRoute, initRouter} from "./components/router.js";
import {renderEditor} from "./pages/editor.js";
import {renderGraph} from "./pages/graph.js";
import {renderTags} from "./pages/tags.js";
import {renderNotesList} from "./pages/notes-list.js";
import {renderSettings} from "./pages/settings.js";
import {listRecentNotes, listFavouriteNotes, listTags} from "./api/client.js";

// Titlebar needs to initialise first, so that the nav can be sized correctly.
await initTitlebar();
// The nav needs to initialise before the router, so that the router can set the correct nav state on route change.
initNav();
initGlobalShortcuts();
initSearch();

// Global, persistent job queue across every route
mountJobQueue();

// Editor page views
registerRoute("/note/new", renderEditor);
registerRoute("/note/:id", renderEditor);
registerRoute("/", renderGraph);
registerRoute("/graph", renderGraph);
registerRoute("/list", () => renderNotesList({trashMode: false}));
registerRoute("/trash", () => renderNotesList({trashMode: true}));
registerRoute("/tags", renderTags);
registerRoute("/tags/:id", ({id}) => renderNotesList({tagId: id}));
registerRoute("/settings", renderSettings);

initRouter();

populateNavData();

// Reloads Recents/Favourites/Tags on a note save
window.addEventListener("echo:note-saved", () => {
	populateNavData();
});

async function populateNavData() {
	/* Populates the nav's Recents, Favourites, and Tags lists. */

	await Promise.all([
		fillList(
			"list-recent",
			() => listRecentNotes(7),
			(n) => n.title || "Untitled",
			"No notes yet",
			(n) => `#/note/${n.id}`,
		),
		fillList(
			"list-favourites",
			listFavouriteNotes,
			(n) => n.title || "Untitled",
			"No favourites yet",
			(n) => `#/note/${n.id}`,
		),
		fillList(
			"list-tags",
			() => listTags({sort: "created_at", order: "desc", limit: 5}),
			(t) => t.name,
			"No tags yet",
			(t) => `#/tags/${t.id}`,
		),
	]);
}

async function fillList(listId, fetchFunc, labelFunc, emptyMessage, hrefFunc) {
	/* Populates each nav list. */
	
	const list = document.getElementById(listId);
	try {
		const items = await fetchFunc();
		list.innerHTML = "";
		if (items.length === 0) {
			list.innerHTML = `<li data-placeholder>${emptyMessage}</li>`;
			return;
		}
		for (const item of items) {
			const li = document.createElement("li");
			if (hrefFunc) {
				const a = document.createElement("a");
				a.href = hrefFunc(item);
				a.textContent = labelFunc(item);
				li.appendChild(a);
			} else {
				li.textContent = labelFunc(item);
			}
			list.appendChild(li);
		}
	} catch (err) {
		console.error(`Failed to load ${listId}`, err);
		list.innerHTML = `<li data-placeholder> Couldn't load!! </li>`;
	}
}
