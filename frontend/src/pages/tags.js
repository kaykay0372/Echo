import {listTags, updateTag, deleteTag} from "../api/client.js";
import {setNavCollapsed} from "../components/nav.js";
import {mountTemplate} from "../utils/templates.js";
import {createConfirmButton} from "../utils/confirm-button.js";

export async function renderTags() {
	const content = document.getElementById("content");
	setNavCollapsed(false);
	mountTemplate(content, "tags-template");

	const listEl = content.querySelector(".tags-page-list");
	const statusEl = content.querySelector(".tags-page-status");
	statusEl.tabIndex = -1; // fallback focus target after a row is removed

	async function refresh() {
		statusEl.textContent = "Loading...";
		try {
			const tags = await listTags();
			render(tags);
		} catch (err) {
			console.error("tags failed to load", err);
			statusEl.textContent = "Couldn't load tags.";
		}
	}

	function render(tags) {
		listEl.innerHTML = "";
		if (tags.length === 0) {
			statusEl.textContent = "No tags yet.";
			return;
		}
		statusEl.textContent = "";
		for (const tag of tags) {
			listEl.appendChild(buildRow(tag));
		}
	}

	function buildRow(tag) {
		const li = document.createElement("li");
		li.className = "tags-page-row";

		const link = document.createElement("a");
		link.href = `#/tags/${tag.id}`;
		link.className = "tags-page-link";
		link.textContent = tag.name;
		li.appendChild(link);

		const actions = document.createElement("span");
		actions.className = "tags-page-actions";

		const renameBtn = document.createElement("button");
		renameBtn.type = "button";
		renameBtn.className = "tags-page-action";
		renameBtn.textContent = "Rename";
		renameBtn.setAttribute("aria-label", `Rename tag ${tag.name}`);
		renameBtn.addEventListener("click", () => startRename(li, link, tag));

		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "tags-page-action tags-page-action-destructive";

		const confirmStatus = document.createElement("span");
		confirmStatus.className = "visually-hidden";
		confirmStatus.setAttribute("aria-live", "assertive");

		createConfirmButton({
			button: deleteBtn,
			statusEl: confirmStatus,
			idleText: "Delete",
			armedText: "Confirm?",
			idleLabel: `Delete tag ${tag.name}`,
			armedLabel: `Confirm deleting tag ${tag.name}`,
			armedMessage: `Delete tag ${tag.name}? Press Delete again within 4 seconds to confirm.`,
			revertMessage: `Delete cancelled. ${tag.name} tag was not deleted.`,
			onConfirm: async () => {
				renameBtn.disabled = true;
				deleteBtn.disabled = true;
				try {
					await deleteTag(tag.id);
					// Switch focus
					const next = li.nextElementSibling;
					const prev = li.previousElementSibling;
					const target =
						next?.querySelector(".tags-page-action:not([disabled])") ??
						prev?.querySelector(".tags-page-action:not([disabled])") ??
						statusEl;
					li.remove();
					target.focus();
				} catch (err) {
					renameBtn.disabled = false;
					deleteBtn.disabled = false;
					throw err;
				}
			},
			onError: (err) => console.error("Delete failed", err),
		});

		actions.appendChild(renameBtn);
		actions.appendChild(deleteBtn);
		actions.appendChild(confirmStatus);
		li.appendChild(actions);
		return li;
	}

	function startRename(li, link, tag) {
		const input = document.createElement("input");
		input.type = "text";
		input.className = "tags-page-rename-input";
		input.value = tag.name;
		input.setAttribute("aria-label", `New name for tag ${tag.name}`);
		link.replaceWith(input);
		input.focus();
		input.select();

		// Only re-focus the link when the edit ended because of a keyboard action.
		let selfInitiatedBlur = false;

		async function commit() {
			const refocusLink = () => {
				if (selfInitiatedBlur) link.focus();
			};
			const newName = input.value.trim();
			if (!newName || newName === tag.name) {
				input.replaceWith(link);
				refocusLink();
				return;
			}
			try {
				const updated = await updateTag(tag.id, {name: newName});
				tag.name = updated.name ?? newName;
				link.textContent = tag.name;
				link.setAttribute("href", `#/tags/${tag.id}`);
				input.replaceWith(link);
				refocusLink();
			} catch (err) {
				console.error("Rename failed", err);
				input.replaceWith(link);
				refocusLink();
			}
		}

		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				selfInitiatedBlur = true;
				input.blur();
			}
			if (e.key === "Escape") {
				selfInitiatedBlur = true;
				// Resetting the value before blur since it automatically calls commit()
				input.value = tag.name;
				input.blur();
			}
		});
	}

	await refresh();

	// No explicit listener cleanup needed here, keeping consistent style.
	return () => {};
}
