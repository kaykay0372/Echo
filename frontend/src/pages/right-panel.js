import {getNoteLinks, getNote, confirmLink, rejectLink} from "../api/client.js";
import {getLinkAutoConfirm} from "../utils/link-behaviour.js";

function otherNoteId(link, noteId) {
	return link.source_note_id === noteId ? link.target_note_id : link.source_note_id;
}

async function resolveOtherNoteTitles(links, noteId) {
	const uniqueIds = [...new Set(links.map((link) => otherNoteId(link, noteId)))];
	const entries = await Promise.all(
		uniqueIds.map(async (id) => {
			try {
				const note = await getNote(id);
				return [id, note.title || "Untitled"];
			} catch (err) {
				console.error(`Couldn't load note ${id}`, err);
				return [id, "Untitled"];
			}
		}),
	);
	return new Map(entries);
}

export async function renderRightPanel(container, noteId, {onPendingCountChange} = {}) {
	container.innerHTML = "";
	container.setAttribute("aria-live", "polite");
	container.tabIndex = -1;
	const loading = document.createElement("p");
	loading.className = "right-panel-status";
	loading.textContent = "Loading connections...";
	container.appendChild(loading);

	async function refresh() {
		let [confirmed, pending] = await Promise.all([
			getNoteLinks(noteId, "confirmed"),
			getNoteLinks(noteId, "pending_approval"),
		]);

		if (getLinkAutoConfirm() && pending.length > 0) {
			await Promise.all(
				pending.map((link) =>
					confirmLink(link.id).catch((err) => {
						console.error(`Couldn't auto-confirm link ${link.id}`, err);
					}),
				),
			);
			// Re-fetch the server state rather than reclassify.
			[confirmed, pending] = await Promise.all([
				getNoteLinks(noteId, "confirmed"),
				getNoteLinks(noteId, "pending_approval"),
			]);
		}

		onPendingCountChange?.(pending.length);
		const titlesById = await resolveOtherNoteTitles([...confirmed, ...pending], noteId);
		render(confirmed, pending, titlesById);
	}

	function showEmpty() {
		const empty = document.createElement("p");
		empty.className = "right-panel-status";
		empty.textContent = "No connections yet.";
		container.appendChild(empty);
	}

	// generate_links handler still always inserts new links as 'pending_approval' for MVP
	function render(confirmed, pending, titlesById) {
		container.innerHTML = "";

		if (getLinkAutoConfirm()) {
			const all = [...confirmed, ...pending];
			if (all.length === 0) {
				showEmpty();
				return;
			}
			container.appendChild(buildSection("Connections", all, false, titlesById, {showHeading: false}));
			return;
		}

		if (confirmed.length === 0 && pending.length === 0) {
			showEmpty();
			return;
		}
		if (pending.length > 0) {
			container.appendChild(buildSection("Pending approval", pending, true, titlesById));
		}
		if (confirmed.length > 0) {
			container.appendChild(buildSection("Backlinks", confirmed, false, titlesById));
		}
	}

	function buildSection(heading, links, showActions, titlesById, {showHeading = true} = {}) {
		const section = document.createElement("section");
		section.className = "connections-section";
		section.setAttribute("aria-label", heading);

		if (showHeading) {
			const h = document.createElement("h3");
			h.className = "connections-section-heading";
			h.textContent = heading;
			section.appendChild(h);
		}

		const list = document.createElement("ul");
		list.className = "connections-list";

		for (const link of links) {
			list.appendChild(buildLinkItem(link, showActions, titlesById));
		}

		section.appendChild(list);
		return section;
	}

	function refocusPendingList(rowIndex) {
		const pendingRows = Array.from(container.querySelectorAll(".connections-list-item")).filter((row) =>
			row.querySelector(".connections-list-action-confirm"),
		);
		const target =
			pendingRows[rowIndex]?.querySelector(".connections-list-action-confirm") ??
			pendingRows[rowIndex - 1]?.querySelector(".connections-list-action-confirm") ??
			container;
		target.focus();
	}

	function buildLinkItem(link, showActions, titlesById) {
		const li = document.createElement("li");
		li.className = "connections-list-item";

		const targetId = otherNoteId(link, noteId);
		const title = titlesById.get(targetId) || "Untitled";
		const href = `#/note/${targetId}`;

		const a = document.createElement("a");
		a.href = href;
		a.className = "connections-list-link";
		a.textContent = title;
		li.appendChild(a);

		li.addEventListener("click", (e) => {
			if (e.target.closest("button") || e.target.closest("a")) return;
			location.hash = href;
		});

		if (showActions) {
			const actions = document.createElement("span");
			actions.className = "connections-list-actions";

			const confirmBtn = document.createElement("button");
			confirmBtn.type = "button";
			confirmBtn.className = "connections-list-action connections-list-action-confirm";
			confirmBtn.textContent = "Confirm";
			confirmBtn.setAttribute("aria-label", `Confirm link to ${title}`);
			confirmBtn.addEventListener("click", async () => {
				confirmBtn.disabled = true;
				rejectBtn.disabled = true;
				const rowIndex = Array.from(li.parentElement?.children ?? []).indexOf(li);
				try {
					await confirmLink(link.id);
					await refresh();
					refocusPendingList(rowIndex);
				} catch (err) {
					console.error("Confirm failed", err);
					confirmBtn.disabled = false;
					rejectBtn.disabled = false;
				}
			});

			const rejectBtn = document.createElement("button");
			rejectBtn.type = "button";
			rejectBtn.className = "connections-list-action connections-list-action-reject";
			rejectBtn.textContent = "Reject";
			rejectBtn.setAttribute("aria-label", `Reject link to ${title}`);
			rejectBtn.addEventListener("click", async () => {
				confirmBtn.disabled = true;
				rejectBtn.disabled = true;
				const rowIndex = Array.from(li.parentElement?.children ?? []).indexOf(li);
				try {
					await rejectLink(link.id);
					await refresh();
					refocusPendingList(rowIndex);
				} catch (err) {
					console.error("Reject failed", err);
					confirmBtn.disabled = false;
					rejectBtn.disabled = false;
				}
			});

			actions.appendChild(confirmBtn);
			actions.appendChild(rejectBtn);
			li.appendChild(actions);
		} else if (typeof link.similarity_score === "number") {
			const score = document.createElement("span");
			score.className = "connections-list-score";
			score.textContent = `${Math.round(link.similarity_score * 100)}%`;
			score.setAttribute("aria-label", `${Math.round(link.similarity_score * 100)} percent similar`);
			li.appendChild(score);
		}

		return li;
	}

	try {
		await refresh();
	} catch (err) {
		console.error("Failed to load", err);
		onPendingCountChange?.(0);
		container.innerHTML = "";
		const errorEl = document.createElement("p");
		errorEl.className = "right-panel-status right-panel-status-error";
		errorEl.textContent = "Couldn't load connections.";
		container.appendChild(errorEl);
	}

	return function cleanup() {
		onPendingCountChange?.(0);
		container.innerHTML = "";
	};
}
