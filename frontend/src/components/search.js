import {searchNotes} from "../api/client.js";
import {debounce} from "../utils/debounce.js";
import {createActivedescendantList} from "../utils/activedescendant-list.js";

const DEBOUNCE_MS = 250;

export function initSearch() {
	const input = document.getElementById("global-search");
	const resultsEl = document.getElementById("search-results");
	if (!input || !resultsEl) return;

	let requestToken = 0;

	function optionEls() {
		return Array.from(resultsEl.querySelectorAll('[role="option"]'));
	}

	function activateOption(index) {
		optionEls()[index]?.querySelector("a")?.click();
	}

	const list = createActivedescendantList({
		input,
		getOptionEls: optionEls,
		onActivate: activateOption,
	});

	function closeResults() {
		resultsEl.hidden = true;
		resultsEl.innerHTML = "";
		input.setAttribute("aria-expanded", "false");
		list.resetActiveIndex();
	}

	function renderResults(notes, query) {
		resultsEl.innerHTML = "";

		if (notes.length === 0) {
			const li = document.createElement("li");
			li.className = "search-results-empty";
			li.textContent = `No notes matching "${query}"`;
			resultsEl.appendChild(li);
			input.setAttribute("aria-expanded", "true");
			resultsEl.hidden = false;
			list.resetActiveIndex();
			return;
		}

		notes.forEach((note, i) => {
			const li = document.createElement("li");
			li.setAttribute("role", "option");
			li.id = `search-result-${i}`;
			li.setAttribute("aria-selected", "false");

			const a = document.createElement("a");
			a.className = "search-results-item";
			a.href = `#/note/${note.id}`;
			a.textContent = note.title || "Untitled";
			a.tabIndex = -1;
			a.addEventListener("click", () => {
				closeResults();
				input.value = "";
			});

			li.appendChild(a);
			resultsEl.appendChild(li);
		});

		resultsEl.hidden = false;
		input.setAttribute("aria-expanded", "true");
		list.setActiveIndex(0);
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
			return;
		}
		if (resultsEl.hidden) return;
		list.handleKey(event);
	});

	// Click-outside dismissal
	document.addEventListener("click", (event) => {
		if (resultsEl.hidden) return;
		if (resultsEl.contains(event.target) || event.target === input) return;
		closeResults();
	});
}
