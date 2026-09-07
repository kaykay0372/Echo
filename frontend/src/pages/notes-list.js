import {listNotesPage, deleteNote, restoreNote, permanentlyDeleteNote, listTags} from "../api/client.js";
import {setNavCollapsed} from "../components/nav.js";
import {mountTemplate} from "../utils/templates.js";
import {createConfirmButton} from "../utils/confirm-button.js";

const PAGE_SIZE = 50;

export async function renderNotesList({trashMode = false, tagId = null} = {}) {
	const content = document.getElementById("content");
	setNavCollapsed(false); // only the editor collapses the nav

	let tagName = null;
	if (tagId) {
		try {
			const tags = await listTags();
			tagName = tags.find((t) => t.id === tagId)?.name ?? null;
		} catch (err) {
			console.error("Failed to resolve tag name", err);
		}
	}

	mountTemplate(content, "notes-list-template");
	content.querySelector(".notes-list-heading").textContent = heading({trashMode, tagId, tagName});
	// This only shows on the non-trash or tag list
	if (!trashMode && !tagId) {
		content.querySelector(".notes-list-graph-view-link").hidden = false;
	}
	const tbody = content.querySelector("tbody");
	const statusEl = content.querySelector(".notes-list-status");
	const loadMoreBtn = content.querySelector("#notes-list-load-more");
	const headingEl = content.querySelector(".notes-list-heading");
	headingEl.tabIndex = -1;

	// Removes a row and moves focus instead of letting it drop to <body.
	function removeRowWithFocus(row) {
		const next = row.nextElementSibling;
		const prev = row.previousElementSibling;
		const target =
			next?.querySelector(".notes-list-actions button:not([disabled])") ??
			prev?.querySelector(".notes-list-actions button:not([disabled])") ??
			headingEl;
		row.remove();
		target.focus();
	}

	let cursor = null;
	let cancelled = false;

	async function loadPage({reset = false} = {}) {
		if (reset) {
			cursor = null;
			tbody.innerHTML = "";
		}
		statusEl.textContent = "Loading...";
		try {
			const {notes, nextCursor} = await listNotesPage({
				deletedOnly: trashMode,
				includeDeleted: trashMode,
				tagId: tagId ?? undefined,
				cursor,
				limit: PAGE_SIZE,
			});
			if (cancelled) return;
			cursor = nextCursor;
			loadMoreBtn.hidden = !cursor;

			// Both must be empty to show the "nothing here" message.
			if (tbody.children.length === 0 && notes.length === 0) {
				statusEl.textContent = trashMode
					? "Trash is empty."
					: tagId
						? "No notes with this tag."
						: "No notes yet.";
				return;
			}
			statusEl.textContent = "";
			for (const note of notes) {
				tbody.appendChild(buildRow(note));
			}
		} catch (err) {
			console.error("Failed to load", err);
			if (!cancelled) statusEl.textContent = "Couldn't load notes.";
		}
	}

	function buildRow(note) {
		const tr = document.createElement("tr");
		tr.className = "notes-list-row";

		const titleCell = document.createElement("td");
		const link = document.createElement("a");
		link.href = `#/note/${note.id}`;
		link.className = "notes-list-title-link";
		link.textContent = note.title || "Untitled";
		titleCell.appendChild(link);
		if (note.is_favourite) {
			const star = document.createElement("span");
			star.className = "notes-list-favourite-star";
			star.setAttribute("aria-label", "Favourite");
			star.textContent = " \u2605";
			titleCell.appendChild(star);
		}
		tr.appendChild(titleCell);

		const updatedCell = document.createElement("td");
		updatedCell.textContent = note.updated_at ? new Date(note.updated_at).toLocaleDateString() : "";
		tr.appendChild(updatedCell);

		const wordsCell = document.createElement("td");
		wordsCell.textContent = `${note.word_count ?? 0}`;
		tr.appendChild(wordsCell);

		const actionsCell = document.createElement("td");
		actionsCell.className = "notes-list-actions";
		actionsCell.appendChild(trashMode ? buildTrashActions(note, tr) : buildActiveActions(note, tr));
		tr.appendChild(actionsCell);

		return tr;
	}

	function buildActiveActions(note, row) {
		const wrap = document.createElement("span");
		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "notes-list-action";
		deleteBtn.textContent = "Delete";
		deleteBtn.setAttribute("aria-label", `Move "${note.title || "Untitled"}" to trash`);
		deleteBtn.addEventListener("click", async () => {
			deleteBtn.disabled = true;
			try {
				await deleteNote(note.id);
				removeRowWithFocus(row);
			} catch (err) {
				console.error("Delete failed", err);
				deleteBtn.disabled = false;
			}
		});
		wrap.appendChild(deleteBtn);
		return wrap;
	}

	function buildTrashActions(note, row) {
		const wrap = document.createElement("span");

		const restoreBtn = document.createElement("button");
		restoreBtn.type = "button";
		restoreBtn.className = "notes-list-action";
		restoreBtn.textContent = "Restore";
		restoreBtn.addEventListener("click", async () => {
			restoreBtn.disabled = true;
			try {
				await restoreNote(note.id);
				removeRowWithFocus(row);
			} catch (err) {
				console.error("Restore failed", err);
				restoreBtn.disabled = false;
			}
		});

		// Two-step confirm inline
		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "notes-list-action notes-list-action-destructive";

		const title = note.title || "Untitled";
		const confirmStatus = document.createElement("span");
		confirmStatus.className = "visually-hidden";
		confirmStatus.setAttribute("aria-live", "assertive");

		createConfirmButton({
			button: deleteBtn,
			statusEl: confirmStatus,
			idleText: "Delete forever",
			armedText: "Confirm delete?",
			armedLabel: `Confirm permanently deleting "${title}"`,
			armedMessage: `Permanently delete "${title}"? Press Delete forever again within 4 seconds to confirm.`,
			revertMessage: `Delete cancelled \u2014 "${title}" was not deleted.`,
			onConfirm: async () => {
				deleteBtn.disabled = true;
				restoreBtn.disabled = true;
				try {
					await permanentlyDeleteNote(note.id);
					removeRowWithFocus(row);
				} catch (err) {
					deleteBtn.disabled = false;
					restoreBtn.disabled = false;
					throw err;
				}
			},
			onError: (err) => console.error("Permanent delete failed", err),
		});

		wrap.appendChild(restoreBtn);
		wrap.appendChild(deleteBtn);
		wrap.appendChild(confirmStatus);
		return wrap;
	}

	loadMoreBtn.addEventListener("click", () => loadPage());
	loadPage({reset: true});

	return function cleanup() {
		cancelled = true;
	};
}

function heading({trashMode, tagId, tagName}) {
	if (trashMode) return "Trash";
	if (tagId) return `Tagged \u201c${tagName || "..."}\u201d`;
	return "Notes";
}
