import {createAttachment, deleteAttachment, getAttachmentFileUrl, getNote} from "../api/client.js";

const POLL_INTERVAL_MS = 5000;

export function renderAttachmentsField(container, noteId, initialAttachments = [], {onImageUploaded} = {}) {
	if (!noteId) {
		container.innerHTML = '<p class="attachments-field-placeholder">Save the note to add attachments.</p>';
		return () => {
			container.innerHTML = "";
		};
	}

	let attachments = initialAttachments.filter((a) => a.file_type !== "image");
	let pollHandle = null;
	let uploading = false;

	function isProcessing(attachment) {
		return attachment.processing_status !== "complete" && attachment.processing_status !== "failed";
	}

	function statusLabel(attachment) {
		switch (attachment.processing_status) {
			case "complete":
				return "Ready";
			case "failed":
				return "Failed";
			default:
				return attachment.file_type === "audio" ? "Transcribing..." : "Captioning...";
		}
	}

	function generatedText(attachment) {
		// Images can carry both a caption and OCR text, audio only carries a transcript
		return [attachment.generated_caption, attachment.generated_ocr_text, attachment.generated_transcript]
			.filter(Boolean)
			.join(" \u00b7 ");
	}

	async function refresh() {
		try {
			const note = await getNote(noteId);
			attachments = (note.attachments || []).filter((a) => a.file_type !== "image");
		} catch (err) {
			console.error("Failed to refresh", err);
			return;
		}
		renderList();
		syncPolling();
	}

	function syncPolling() {
		const anyProcessing = attachments.some(isProcessing);
		if (anyProcessing && !pollHandle) {
			pollHandle = setInterval(refresh, POLL_INTERVAL_MS);
		} else if (!anyProcessing && pollHandle) {
			clearInterval(pollHandle);
			pollHandle = null;
		}
	}

	function buildRow(attachment) {
		const li = document.createElement("li");
		li.className = "attachments-field-item";

		const link = document.createElement("a");
		link.className = "attachments-field-file-link";
		link.href = getAttachmentFileUrl(attachment.id);
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		link.textContent = "\ud83c\udfb5";
		link.setAttribute("aria-label", "Open audio attachment");
		li.appendChild(link);

		const info = document.createElement("div");
		info.className = "attachments-field-info";

		const status = document.createElement("span");
		status.className = `attachments-field-status attachments-field-status-${attachment.processing_status}`;
		status.textContent = statusLabel(attachment);
		info.appendChild(status);

		const text = generatedText(attachment);
		if (text) {
			const generated = document.createElement("p");
			generated.className = "attachments-field-generated-text";
			generated.textContent = text;
			info.appendChild(generated);
		}

		li.appendChild(info);

		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "attachments-field-remove";
		removeBtn.textContent = "\u00d7";
		removeBtn.setAttribute("aria-label", "Remove attachment");
		removeBtn.addEventListener("click", async () => {
			removeBtn.disabled = true;
			try {
				await deleteAttachment(noteId, attachment.id);
				attachments = attachments.filter((a) => a.id !== attachment.id);
				renderList();
				syncPolling();
			} catch (err) {
				console.error("Remove failed", err);
				removeBtn.disabled = false;
			}
		});
		li.appendChild(removeBtn);

		return li;
	}

	function renderList() {
		const list = container.querySelector(".attachments-field-list");
		if (!list) return;
		list.innerHTML = "";
		for (const attachment of attachments) {
			list.appendChild(buildRow(attachment));
		}
	}

	function renderShell() {
		container.innerHTML = "";

		const field = document.createElement("div");
		field.className = "attachments-field";

		const heading = document.createElement("div");
		heading.className = "attachments-field-heading";
		heading.textContent = "Audio attachments";
		field.appendChild(heading);

		const list = document.createElement("ul");
		list.className = "attachments-field-list";
		field.appendChild(list);

		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.className = "attachments-field-file-input";
		fileInput.id = "attachments-field-input";
		fileInput.hidden = true;
		field.appendChild(fileInput);

		const addBtn = document.createElement("button");
		addBtn.type = "button";
		addBtn.className = "attachments-field-add-btn";
		addBtn.textContent = "+ Add attachment";
		addBtn.addEventListener("click", () => fileInput.click());
		field.appendChild(addBtn);

		const errorEl = document.createElement("p");
		errorEl.className = "attachments-field-error";
		errorEl.hidden = true;
		field.appendChild(errorEl);

		fileInput.addEventListener("change", async () => {
			const file = fileInput.files?.[0];
			fileInput.value = ""; // Allow re-selecting the same file later
			if (!file || uploading) return;

			errorEl.hidden = true;
			uploading = true;
			addBtn.disabled = true;
			try {
				const attachment = await createAttachment(noteId, file);
				if (attachment.file_type === "image") {
					onImageUploaded?.(attachment);
				} else {
					attachments = [...attachments, attachment];
					renderList();
					syncPolling();
				}
			} catch (err) {
				console.error("Upload failed", err);
				if (err.status === 409) {
					errorEl.textContent = "This exact file is already attached to this note.";
				} else {
					errorEl.textContent = "Couldn't upload that file.";
				}
				errorEl.hidden = false;
			} finally {
				uploading = false;
				addBtn.disabled = false;
			}
		});

		container.appendChild(field);
		renderList();
	}

	renderShell();
	syncPolling();

	return function cleanup() {
		if (pollHandle) clearInterval(pollHandle);
		container.innerHTML = "";
	};
}
