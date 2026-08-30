import {searchNotes} from "../api/client.js";
import {debounce} from "../utils/debounce.js";

const DEBOUNCE_MS = 250;

export function initSearch() {
	const input = document.getElementById("global-search");
	const resultsEl = document.getElementById("search-results");
	if (!input || !resultsEl) return;

	// Content match + all-notes for tag matching.
	let requestToken = 0;

	function closeResults() {
		resultsEl.hidden = true;
		resultsEl.innerHTML = "";
		input.setAttribute("aria-expanded", "false");
	}

	function renderResults(notes, query) {
		resultsEl.innerHTML = "";

		if (notes.length === 0) {
			const li = document.createElement("li");
			li.className = "search-results-empty";
			li.textContent = `No notes matching "${query}"`;
			resultsEl.appendChild(li);
		} else {
			for (const note of notes) {
				const li = document.createElement("li");
				li.setAttribute("role", "option");

				const a = document.createElement("a");
				a.className = "search-results-item";
				a.href = `#/note/${note.id}`;
				a.textContent = note.title || "Untitled";
				a.addEventListener("click", () => {
					closeResults();
					input.value = "";
				});

				li.appendChild(a);
				resultsEl.appendChild(li);
			}
		}

		resultsEl.hidden = false;
		input.setAttribute("aria-expanded", "true");
	}

	const runSearch = debounce(async (query) => {
		const myToken = ++requestToken;
		let notes;
		try {
			notes = await searchNotes(query);
		} catch (err) {
			console.error("Search failed", err);
			return;
		}
		if (myToken !== requestToken) return; // superseded by a newer keystroke
		renderResults(notes, query);
	}, DEBOUNCE_MS);

	input.addEventListener("input", () => {
		const query = input.value.trim();
		if (!query) {
			requestToken++; // invalidate any in-flight search from before the clear
			closeResults();
			return;
		}
		runSearch(query);
	});

	input.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			closeResults();
			input.blur();
		}
	});

	// Click-outside dismissal
	document.addEventListener("click", (event) => {
		if (resultsEl.hidden) return;
		if (resultsEl.contains(event.target) || event.target === input) return;
		closeResults();
	});
}
