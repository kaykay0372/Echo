const BASE_URL = "http://127.0.0.1:8000";

async function request(path, options = {}) {
	/* Connects to the backend API. */
	const res = await fetch(`${BASE_URL}${path}`, {
		headers: {"Content-Type": "application/json", ...options.headers},
		...options,
	});
	if (!res.ok) {
		// Revisit
		const body = await res.text();
		throw new Error(`${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
	}
	if (res.status === 204) return null;
	return res.json();
}

// -------------------- Notes --------------------
const MAX_NOTES_LIMIT = 200;

function unwrapNotesResponse(response) {
	if (response && Array.isArray(response.notes)) return response;
	throw new Error("/notes response shape doesn't match NoteListResponse ");
}

export async function listNotesPage({
	limit,
	includeDeleted,
	noteType,
	tagId,
	search,
	favourite,
	deletedOnly,
	cursor,
} = {}) {
	/* Fetches the notes page with the given parameters. */

	// Client-side limit clamp
	if (limit != null && limit > MAX_NOTES_LIMIT) {
		console.warn(`ListNotes limit=${limit} exceeds the server's max (${MAX_NOTES_LIMIT})`);
		limit = MAX_NOTES_LIMIT;
	}

	const params = new URLSearchParams();
	if (limit != null) params.set("limit", limit);
	if (includeDeleted != null) params.set("include_deleted", includeDeleted);
	if (noteType != null) params.set("note_type", noteType);
	if (tagId != null) params.set("tag_id", tagId);
	if (search != null) params.set("search", search);
	if (favourite != null) params.set("favourite", favourite);
	if (deletedOnly != null) params.set("deleted_only", deletedOnly);
	if (cursor != null) params.set("cursor", cursor);

	const qs = params.toString();
	const response = await request(`/notes${qs ? `?${qs}` : ""}`);
	const {notes} = unwrapNotesResponse(response);
	return {notes, nextCursor: response.next_cursor ?? null};
}

export async function listNotes(options = {}) {
	/* For the notes page array without pagination. */
	const {notes} = await listNotesPage(options);
	return notes;
}

export async function listRecentNotes(limit = 20) {
	return listNotes({limit});
}

export async function listFavouriteNotes() {
	return listNotes({favourite: true, limit: MAX_NOTES_LIMIT});
}

export async function listTrashedNotes() {
	return listNotes({deletedOnly: true, limit: MAX_NOTES_LIMIT});
}

export async function createNote(payload) {
	return request("/notes", {method: "POST", body: JSON.stringify(payload)});
}

export async function batchImportNotes(payload) {
	return request("/notes/batch", {method: "POST", body: JSON.stringify(payload)});
}

export async function getNote(noteId) {
	return request(`/notes/${noteId}`);
}

export async function updateNote(noteId, payload) {
	return request(`/notes/${noteId}`, {method: "PATCH", body: JSON.stringify(payload)});
}

export async function deleteNote(noteId) {
	return request(`/notes/${noteId}`, {method: "DELETE"});
}

export async function permanentlyDeleteNote(noteId) {
	return request(`/notes/${noteId}/permanent`, {method: "DELETE"});
}

export async function restoreNote(noteId) {
	return request(`/notes/${noteId}/restore`, {method: "POST"});
}

export async function getNoteConnections(noteId, limit = 5) {
	return request(`/notes/${noteId}/connections?limit=${limit}`);
}

export async function getNoteLinks(noteId, status) {
	const qs = status ? `?status=${encodeURIComponent(status)}` : "";
	return request(`/notes/${noteId}/links${qs}`);
}

export async function createAttachment(noteId, file) {
	/* Uploads a file as an attachment to the given note. */
	const form = new FormData();
	form.append("file", file);
	const res = await fetch(`${BASE_URL}/notes/${noteId}/attachments`, {
		method: "POST",
		body: form,
	});
	if (!res.ok) {
		// Differentiating between a duplicate-content conflict and a generic failure.

		let body = null;
		try {
			body = await res.json();
		} catch {
			// Not JSON
		}
		const err = new Error(`Attachment upload -> ${res.status}: ${body?.detail || res.statusText}`);
		err.status = res.status;
		err.existingNoteId = body?.existing_note_id ?? null;
		throw err;
	}
	return res.json();
}

export async function deleteAttachment(noteId, attachmentId) {
	return request(`/notes/${noteId}/attachments/${attachmentId}`, {method: "DELETE"});
}

export function getAttachmentFileUrl(attachmentId) {
	return `${BASE_URL}/attachments/${attachmentId}/file`;
}

// -------------------- Tags --------------------

export async function listTags({sort, order, limit} = {}) {
	const params = new URLSearchParams();
	if (sort != null) params.set("sort", sort);
	if (order != null) params.set("order", order);
	if (limit != null) params.set("limit", limit);
	const qs = params.toString();
	return request(`/tags${qs ? `?${qs}` : ""}`);
}

export async function createTag({name, parentId}) {
	return request("/tags", {method: "POST", body: JSON.stringify({name, parent_id: parentId})});
}

export async function updateTag(tagId, payload) {
	return request(`/tags/${tagId}`, {method: "PATCH", body: JSON.stringify(payload)});
}

export async function deleteTag(tagId) {
	return request(`/tags/${tagId}`, {method: "DELETE"});
}

export async function assignTag(noteId, tagId) {
	return request(`/notes/${noteId}/tags`, {method: "POST", body: JSON.stringify({tag_id: tagId})});
}

export async function removeTag(noteId, tagId) {
	return request(`/notes/${noteId}/tags/${tagId}`, {method: "DELETE"});
}

// -------------------- Jobs --------------------

export async function getJobQueueStatus({status, limit = 50} = {}) {
	const params = new URLSearchParams();
	if (status != null) params.set("status", status);
	if (limit != null) params.set("limit", limit);
	return request(`/jobs?${params.toString()}`);
}

export async function retryJob(jobId) {
	return request(`/jobs/${jobId}/retry`, {method: "POST"});
}

export async function discardJob(jobId) {
	return request(`/jobs/${jobId}/discard`, {method: "POST"});
}

export async function deleteJob(jobId) {
	return request(`/jobs/${jobId}`, {method: "DELETE"});
}

// -------------------- Graph --------------------

export async function getGraph() {
	return request("/graph");
}

// -------------------- Links --------------------

export async function confirmLink(linkId) {
	return request(`/links/${linkId}/confirm`, {method: "POST"});
}

export async function rejectLink(linkId) {
	return request(`/links/${linkId}/reject`, {method: "POST"});
}

// -------------------- Search --------------------

export async function searchNotes(query) {
	const trimmed = (query || "").trim();
	if (!trimmed) return [];

	const [contentMatches, allNotes] = await Promise.all([
		listNotes({search: trimmed, limit: MAX_NOTES_LIMIT}),
		listNotes({limit: MAX_NOTES_LIMIT}),
	]);

	const lowerQuery = trimmed.toLowerCase();
	const tagMatches = allNotes.filter((note) =>
		(note.tags || []).some((tag) => tag.name?.toLowerCase().includes(lowerQuery)),
	);

	const byId = new Map();
	for (const note of [...contentMatches, ...tagMatches]) {
		byId.set(note.id, note);
	}
	return Array.from(byId.values());
}
