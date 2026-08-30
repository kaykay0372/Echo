import {Editor} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {getNote, createNote, updateNote, deleteNote, deleteAttachment, getAttachmentFileUrl} from "../api/client.js";
import {setNavCollapsed} from "../components/nav.js";
import {debounce} from "../utils/debounce.js";
import {mountTemplate} from "../utils/templates.js";
import {createCollapsiblePanel} from "../utils/collapsible-panel.js";
import {renderRightPanel} from "./right-panel.js";
import {renderTagsField} from "../components/tags-field.js";
import {renderAttachmentsField} from "../components/attachments-field.js";

const AUTOSAVE_DELAY_MS = 800;

// Extends TipTap's Image node with an attachmentId attribute so an embedded image can be traced back to its Attachment row.
const ImageWithAttachmentId = Image.extend({
	addAttributes() {
		return {
			...this.parent(),
			attachmentId: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-attachment-id"),
				renderHTML: (attributes) =>
					attributes.attachmentId ? {"data-attachment-id": attributes.attachmentId} : {},
			},
		};
	},
});

// Walks the current document for embedded images and returns the set of attachment ids they reference.
function getEmbeddedImageAttachmentIds(editorInstance) {
	const ids = new Set();
	editorInstance.state.doc.descendants((node) => {
		if (node.type.name === "image" && node.attrs.attachmentId) {
			ids.add(node.attrs.attachmentId);
		}
		return true;
	});
	return ids;
}

// Launches the OS's default browser
async function openExternalLink(url) {
	const isTauri = typeof window !== "undefined" && "__TAURI__" in window;
	if (isTauri) {
		try {
			const {open} = await import("@tauri-apps/plugin-shell");
			await open(url);
			return;
		} catch (err) {
			console.warn("Couldn't open link", err);
		}
	}
	openInBrowserTab(url);
}

// Allows opening a link in a new tab without the new page having access to the opener (security best practice).
function openInBrowserTab(url) {
	const a = document.createElement("a");
	a.href = url;
	a.target = "_blank";
	a.rel = "noopener noreferrer";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

// Guards against a previous mount's listener still being attached, which would cause multiple saves without a full page reload.
let activeEditorKeydownHandler = null;

export async function renderEditor({id} = {}) {
	const content = document.getElementById("content");
	const isNew = !id || id === "new";

	let note;
	try {
		note = isNew
			? {title: "", body: "", word_count: 0, is_favourite: false, tags: [], attachments: []}
			: await getNote(id);
	} catch (err) {
		console.error("Failed to load note", err);
		content.innerHTML = `<p class="editor-error" role="alert">Couldn't load that note.</p>`;
		return null;
	}

	let noteId = isNew ? null : id;

	mountTemplate(content, "editor-template");
	setNavCollapsed(true);

	const titleInput = content.querySelector("#editor-title");
	const tagsContainer = content.querySelector("#tags-field");
	const attachmentsContainer = content.querySelector("#attachments-field");
	const editorMount = content.querySelector("#editor-content");
	const statusEl = content.querySelector("#save-status");
	const wordCountEl = content.querySelector("#word-count");
	const metaEl = content.querySelector("#editor-meta-dates");
	const favouriteBtn = content.querySelector("#favourite-btn");
	const connectionsContainer = content.querySelector("#right-panel-connections-body");
	const rightPanelBadge = content.querySelector("#right-panel-badge");

	const rightPanel = createCollapsiblePanel({
		panelId: "right-panel",
		toggleId: "right-panel-pin-toggle",
		storageKeyPrefix: "echo:right-panel",
		collapsedClass: "right-panel-collapsed",
		pinnedClass: "right-panel-pinned",
		pinnedLabel: "Keep connections panel open",
		pinnedLabelActive: "Keep connections panel open (currently pinned)",
	});
	rightPanel.init();
	rightPanel.setForceCollapsed(true);

	function updateBadge(count) {
		if (!rightPanelBadge) return;
		if (count > 0) {
			rightPanelBadge.textContent = String(count);
			rightPanelBadge.hidden = false;
		} else {
			rightPanelBadge.hidden = true;
		}
	}

	titleInput.value = note.title || "";
	updateWordCount(note.word_count ?? 0);
	updateDates(note);
	updateFavouriteButton(note.is_favourite);

	// Embed at the current cursor position, or at the end if the editor isn't focused.
	function insertImageAttachment(attachment) {
		tiptapEditor
			.chain()
			.focus()
			.setImage({
				src: getAttachmentFileUrl(attachment.id),
				alt: attachment.generated_caption || "",
				attachmentId: attachment.id,
			})
			.run();
	}

	let tagsCleanup = renderTagsField(tagsContainer, noteId, note.tags || []);
	let attachmentsCleanup = renderAttachmentsField(attachmentsContainer, noteId, note.attachments || [], {
		onImageUploaded: insertImageAttachment,
	});

	let connectionsCleanup = null;
	if (!isNew) {
		connectionsCleanup = await renderRightPanel(connectionsContainer, noteId, {
			onPendingCountChange: updateBadge,
		});
	} else {
		connectionsContainer.innerHTML =
			'<p class="right-panel__status">Connections appear once the note is saved.</p>';
	}

	function updateWordCount(count) {
		wordCountEl.textContent = `${count} word${count === 1 ? "" : "s"}`;
	}

	function updateDates(n) {
		if (!n.created_at) {
			metaEl.textContent = "";
			return;
		}
		const created = new Date(n.created_at).toLocaleDateString();
		const updated = n.updated_at ? new Date(n.updated_at).toLocaleDateString() : created;
		metaEl.textContent = `Created ${created} \u00b7 Updated ${updated}`;
	}

	function updateFavouriteButton(isFavourite) {
		favouriteBtn.setAttribute("aria-pressed", String(!!isFavourite));
		favouriteBtn.setAttribute("aria-label", isFavourite ? "Remove from favourites" : "Add to favourites");
		favouriteBtn.textContent = isFavourite ? "\u2605" : "\u2606";
	}

	function setStatus(text) {
		statusEl.textContent = text;
	}

	let saveInFlight = false;
	let noteTrashed = false;
	let knownEmbeddedImageIds = new Set();

	async function persist() {
		setStatus("Saving...");
		saveInFlight = true;
		const payload = {title: titleInput.value, body: tiptapEditor.getHTML()};

		// Clean up embedded images thath were removed.
		const currentEmbeddedImageIds = getEmbeddedImageAttachmentIds(tiptapEditor);
		const removedImageIds = [...knownEmbeddedImageIds].filter((id) => !currentEmbeddedImageIds.has(id));
		knownEmbeddedImageIds = currentEmbeddedImageIds;
		if (noteId && removedImageIds.length > 0) {
			for (const attachmentId of removedImageIds) {
				deleteAttachment(noteId, attachmentId).catch((err) =>
					console.error("Orphaned image cleanup failed", attachmentId, err),
				);
			}
		}

		try {
			if (noteId) {
				note = await updateNote(noteId, payload);
			} else {
				note = await createNote({...payload, note_type: "text"});
				noteId = note.id;
				history.replaceState(null, "", `#/note/${noteId}`);
				connectionsCleanup = await renderRightPanel(connectionsContainer, noteId, {
					onPendingCountChange: updateBadge,
				});
				tagsCleanup?.();
				tagsCleanup = renderTagsField(tagsContainer, noteId, note.tags || []);
				attachmentsCleanup?.();
				attachmentsCleanup = renderAttachmentsField(attachmentsContainer, noteId, note.attachments || [], {
					onImageUploaded: insertImageAttachment,
				});
			}
			setStatus("Saved");
			updateWordCount(note.word_count ?? 0);
			updateDates(note);
			// Re-populate attachment field.
			window.dispatchEvent(new CustomEvent("echo:note-saved", {detail: {note}}));
		} catch (err) {
			console.error("Autosave failed", err);
			setStatus("Error saving \u2014 check your connection");
		} finally {
			saveInFlight = false;
		}
	}

	const debouncedPersist = debounce(persist, AUTOSAVE_DELAY_MS);

	titleInput.addEventListener("input", () => {
		setStatus("Unsaved changes...");
		debouncedPersist();
	});

	favouriteBtn.addEventListener("click", async () => {
		if (!noteId) return;
		const nextValue = favouriteBtn.getAttribute("aria-pressed") !== "true";
		updateFavouriteButton(nextValue); // optimistic
		try {
			note = await updateNote(noteId, {is_favourite: nextValue});
			window.dispatchEvent(new CustomEvent("echo:note-saved", {detail: {note}}));
		} catch (err) {
			console.error("Favourite toggle failed", err);
			updateFavouriteButton(!nextValue); // revert
		}
	});
	if (!noteId) {
		favouriteBtn.disabled = true;
		favouriteBtn.setAttribute("aria-label", "Save the note to favourite it");
	}

	// Editor-scoped shortcuts
	function handleEditorKeydown(event) {
		if (!event.ctrlKey) return;

		if (event.key.toLowerCase() === "s") {
			event.preventDefault();
			debouncedPersist.cancel();
			if (!saveInFlight) persist();
		} else if (event.key.toLowerCase() === "d") {
			event.preventDefault();
			if (!favouriteBtn.disabled) favouriteBtn.click();
		} else if (event.key === "Backspace") {
			event.preventDefault();
			if (noteId) {
				deleteNote(noteId)
					.then(() => {
						noteTrashed = true;
						navigate("/list");
					})
					.catch((err) => console.error("Trash via shortcut failed", err));
			}
		}
	}

	function navigate(path) {
		location.hash = `#${path}`;
	}

	if (activeEditorKeydownHandler) {
		document.removeEventListener("keydown", activeEditorKeydownHandler);
	}
	activeEditorKeydownHandler = handleEditorKeydown;
	document.addEventListener("keydown", handleEditorKeydown);

	const tiptapEditor = new Editor({
		element: editorMount,
		extensions: [
			StarterKit,
			Placeholder.configure({placeholder: "Start writing..."}),
			Link.configure({autolink: true, linkOnPaste: true, openOnClick: false}),
			ImageWithAttachmentId,
		],
		content: note.body || "",
		editorProps: {
			handleClick(_view, _pos, event) {
				if (!event.ctrlKey) return false;
				const anchor = event.target.closest?.("a[href]");
				if (!anchor) return false;
				event.preventDefault();
				openExternalLink(anchor.href);
				return true;
			},
		},
		onUpdate: () => {
			setStatus("Unsaved changes...");
			debouncedPersist();
		},
	});
	// Seeds the orphan-cleanup baseline with whatever images the note already had
	knownEmbeddedImageIds = getEmbeddedImageAttachmentIds(tiptapEditor);

	return function cleanup() {
		debouncedPersist.cancel();
		if (!saveInFlight && !noteTrashed) persist();
		tiptapEditor.destroy();
		document.removeEventListener("keydown", handleEditorKeydown);
		if (activeEditorKeydownHandler === handleEditorKeydown) activeEditorKeydownHandler = null;
		if (typeof connectionsCleanup === "function") connectionsCleanup();
		if (typeof tagsCleanup === "function") tagsCleanup();
		if (typeof attachmentsCleanup === "function") attachmentsCleanup();
		rightPanel.destroy();
		setNavCollapsed(false);
	};
}
