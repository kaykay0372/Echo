import {listTags, createTag, assignTag, removeTag} from "../api/client.js";

export function renderTagsField(container, noteId, initialTags = []) {
	if (!noteId) {
		container.innerHTML = '<p class="tags-field-placeholder">Save the note to add tags.</p>';
		return () => {
			container.innerHTML = "";
		};
	}

	let tags = [...initialTags];
	let popover = null;
	let fieldEl = null;

	function closePopover({refocusAddBtn = true} = {}) {
		if (!popover) return;
		document.removeEventListener("mousedown", handleOutsideClick, true);
		popover.remove();
		popover = null;
		const addBtn = container.querySelector(".tags-field-add-btn");
		if (addBtn) {
			addBtn.setAttribute("aria-expanded", "false");
			if (refocusAddBtn) addBtn.focus();
		}
	}

	function handleOutsideClick(e) {
		if (popover && !popover.contains(e.target) && !e.target.closest(".tags-field-add-btn")) {
			closePopover({refocusAddBtn: false});
		}
	}

	async function openPopover(addBtn) {
		if (popover) return;

		popover = document.createElement("div");
		popover.className = "tags-field-popover";

		const input = document.createElement("input");
		input.type = "text";
		input.className = "tags-field-input";
		input.setAttribute("role", "combobox");
		input.setAttribute("aria-expanded", "true");
		input.setAttribute("aria-controls", "tags-field-listbox");
		input.setAttribute("aria-autocomplete", "list");
		input.setAttribute("aria-label", "Search or create a tag");
		input.placeholder = "Search or create tag...";

		const listbox = document.createElement("ul");
		listbox.className = "tags-field-listbox";
		listbox.id = "tags-field-listbox";
		listbox.setAttribute("role", "listbox");

		popover.appendChild(input);
		popover.appendChild(listbox);
		fieldEl.appendChild(popover);
		addBtn.setAttribute("aria-expanded", "true");

		let allTags = [];
		try {
			allTags = await listTags();
		} catch (err) {
			console.error("Failed to load tags", err);
		}

		function renderOptions(query) {
			listbox.innerHTML = "";
			const q = query.trim().toLowerCase();
			const assignedIds = new Set(tags.map((t) => t.id));
			const matches = allTags.filter((t) => !assignedIds.has(t.id) && t.name.toLowerCase().includes(q));

			for (const tag of matches) {
				const li = document.createElement("li");
				li.className = "tags-field-option";
				li.setAttribute("role", "option");
				li.textContent = tag.name;
				li.addEventListener("click", () => selectExisting(tag));
				listbox.appendChild(li);
			}

			const exact = allTags.some((t) => t.name.toLowerCase() === q);
			if (q && !exact) {
				const li = document.createElement("li");
				li.className = "tags-field-option tags-field-option-create";
				li.setAttribute("role", "option");
				li.textContent = `Create "${query.trim()}"`;
				li.addEventListener("click", () => createAndSelect(query.trim()));
				listbox.appendChild(li);
			}
		}

		async function selectExisting(tag) {
			try {
				await assignTag(noteId, tag.id);
				tags = [...tags, tag];
				renderChips();
				closePopover();
			} catch (err) {
				console.error("assign failed", err);
			}
		}

		async function createAndSelect(name) {
			if (!name) return;
			try {
				const tag = await createTag({name});
				await assignTag(noteId, tag.id);
				tags = [...tags, tag];
				allTags = [...allTags, tag];
				renderChips();
				closePopover();
			} catch (err) {
				console.error("create failed", err);
			}
		}

		input.addEventListener("input", () => renderOptions(input.value));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				closePopover();
			} else if (e.key === "Enter") {
				e.preventDefault();
				const firstOption = listbox.querySelector(".tags-field-option");
				firstOption?.click();
			}
		});

		renderOptions("");
		input.focus();
		document.addEventListener("mousedown", handleOutsideClick, true);
	}

	function renderChips() {
		container.innerHTML = "";
		const field = document.createElement("div");
		field.className = "tags-field";
		fieldEl = field;

		for (const tag of tags) {
			const chip = document.createElement("span");
			chip.className = "tag-chip";

			const label = document.createElement("span");
			label.textContent = tag.name;
			chip.appendChild(label);

			const removeBtn = document.createElement("button");
			removeBtn.type = "button";
			removeBtn.className = "tag-chip-remove";
			removeBtn.textContent = "\u00d7";
			removeBtn.setAttribute("aria-label", `Remove tag ${tag.name}`);
			removeBtn.addEventListener("click", async () => {
				try {
					await removeTag(noteId, tag.id);
					tags = tags.filter((t) => t.id !== tag.id);
					renderChips();
				} catch (err) {
					console.error("remove failed", err);
				}
			});
			chip.appendChild(removeBtn);
			field.appendChild(chip);
		}

		const addBtn = document.createElement("button");
		addBtn.type = "button";
		addBtn.className = "tags-field-add-btn";
		addBtn.setAttribute("aria-expanded", "false");
		addBtn.setAttribute("aria-haspopup", "listbox");
		addBtn.textContent = tags.length ? "+ Add" : "+ Add tag";
		addBtn.addEventListener("click", () => {
			if (popover) {
				closePopover();
			} else {
				openPopover(addBtn);
			}
		});
		field.appendChild(addBtn);

		container.appendChild(field);
	}

	renderChips();

	return function cleanup() {
		document.removeEventListener("mousedown", handleOutsideClick, true);
		container.innerHTML = "";
	};
}
