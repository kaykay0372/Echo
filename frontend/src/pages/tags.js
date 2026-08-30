import {listTags, updateTag, deleteTag} from "../api/client.js";
import {setNavCollapsed} from "../components/nav.js";
import {mountTemplate} from "../utils/templates.js";

export async function renderTags() {
	const content = document.getElementById("content");
	setNavCollapsed(false);
	mountTemplate(content, "tags-template");

	const listEl = content.querySelector(".tags-page-list");
	const statusEl = content.querySelector(".tags-page-status");

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
		deleteBtn.textContent = "Delete";
		deleteBtn.setAttribute("aria-label", `Delete tag ${tag.name}`);
		let confirming = false;
		let revertTimer = null;
		deleteBtn.addEventListener("click", async () => {
			if (!confirming) {
				confirming = true;
				deleteBtn.textContent = "Confirm?";
				revertTimer = setTimeout(() => {
					confirming = false;
					deleteBtn.textContent = "Delete";
				}, 4000);
				return;
			}
			clearTimeout(revertTimer);
			renameBtn.disabled = true;
			deleteBtn.disabled = true;
			try {
				await deleteTag(tag.id);
				li.remove();
			} catch (err) {
				console.error("Delete failed", err);
				renameBtn.disabled = false;
				deleteBtn.disabled = false;
				confirming = false;
				deleteBtn.textContent = "Delete";
			}
		});

		actions.appendChild(renameBtn);
		actions.appendChild(deleteBtn);
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

		async function commit() {
			const newName = input.value.trim();
			if (!newName || newName === tag.name) {
				input.replaceWith(link);
				return;
			}
			try {
				const updated = await updateTag(tag.id, {name: newName});
				tag.name = updated.name ?? newName;
				link.textContent = tag.name;
				link.setAttribute("href", `#/tags/${tag.id}`);
				input.replaceWith(link);
			} catch (err) {
				console.error("Rename failed", err);
				input.replaceWith(link);
			}
		}

		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") input.blur();
			if (e.key === "Escape") {
				input.value = tag.name;
				input.blur();
			}
		});
	}

	await refresh();

	// Clean up event listeners
	return () => {};
}
