import {beforeEach, afterEach, describe, expect, it, vi} from "vitest";
import {installRealTemplates} from "../utils/install-real-templates.js";

vi.mock("../api/client.js", () => ({
	getNote: vi.fn(),
	createNote: vi.fn(),
	updateNote: vi.fn(),
	deleteNote: vi.fn(),
	deleteAttachment: vi.fn(),
	getAttachmentFileUrl: vi.fn((id) => `http://127.0.0.1:8000/attachments/${id}/file`),
}));

vi.mock("../components/nav.js", () => ({
	setNavCollapsed: vi.fn(),
}));

vi.mock("./right-panel.js", () => ({
	renderRightPanel: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../components/tags-field.js", () => ({
	renderTagsField: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../components/attachments-field.js", () => ({
	renderAttachmentsField: vi.fn().mockReturnValue(vi.fn()),
}));

let lastCollapsiblePanelInstance = null;
vi.mock("../utils/collapsible-panel.js", () => ({
	createCollapsiblePanel: vi.fn().mockImplementation(() => {
		const instance = {
			init: vi.fn(),
			destroy: vi.fn(),
			setForceCollapsed: vi.fn(),
		};
		lastCollapsiblePanelInstance = instance;
		return instance;
	}),
}));

// Mock TipTap
let lastEditorInstance = null;
vi.mock("@tiptap/core", () => ({
	Editor: vi.fn().mockImplementation(function (config) {
		const chainable = {
			focus: vi.fn(() => chainable),
			setImage: vi.fn(() => chainable),
			run: vi.fn(),
		};
		const instance = {
			config,
			destroy: vi.fn(),
			getHTML: vi.fn().mockReturnValue("<p>mock html</p>"),
			chain: vi.fn(() => chainable),
			chainable, // exposed so tests can assert on setImage/run calls directly
			__imageNodes: [],
			state: {
				doc: {
					descendants: vi.fn(function (callback) {
						for (const node of instance.__imageNodes) callback(node);
					}),
				},
			},
		};
		lastEditorInstance = instance;
		return instance;
	}),
}));
vi.mock("@tiptap/starter-kit", () => ({default: {}}));
vi.mock("@tiptap/extension-placeholder", () => ({
	default: {configure: vi.fn().mockReturnValue({})},
}));
vi.mock("@tiptap/extension-link", () => ({
	default: {configure: vi.fn().mockReturnValue({})},
}));
vi.mock("@tiptap/extension-image", () => ({
	default: {extend: vi.fn().mockReturnValue({})},
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
	open: vi.fn(),
}));

import {getNote, createNote, updateNote, deleteNote, deleteAttachment} from "../api/client.js";
import {setNavCollapsed} from "../components/nav.js";
import {renderTagsField} from "../components/tags-field.js";
import {renderAttachmentsField} from "../components/attachments-field.js";
import {renderRightPanel} from "./right-panel.js";
import {renderEditor} from "./editor.js";

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	document.body.innerHTML = `<main id="content"></main>`;
	installRealTemplates();
	location.hash = "";
});

afterEach(() => {
	vi.useRealTimers();
});

describe("renderEditor loading an existing note", () => {
	it("fetches the note and populates the title field", async () => {
		getNote.mockResolvedValue({
			id: "n1",
			title: "My Note",
			body: "<p>hi</p>",
			word_count: 2,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		});

		await renderEditor({id: "n1"});

		expect(getNote).toHaveBeenCalledWith("n1");
		expect(document.getElementById("editor-title").value).toBe("My Note");
		expect(document.getElementById("word-count").textContent).toContain("2");
	});

	it("collapses the nav on mount", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		expect(setNavCollapsed).toHaveBeenCalledWith(true);
	});

	it("shows an error message instead of throwing if the note fails to load", async () => {
		getNote.mockRejectedValue(new Error("network down"));

		await renderEditor({id: "n1"});

		expect(document.getElementById("content").textContent).toContain("Couldn't load");
	});
});

describe("renderEditor new note", () => {
	it("does not call getNote for a new note", async () => {
		await renderEditor({id: "new"});
		expect(getNote).not.toHaveBeenCalled();
	});

	it("creates the note on first autosave rather than updating", async () => {
		createNote.mockResolvedValue({id: "n2", title: "First", word_count: 1});

		await renderEditor({id: "new"});
		document.getElementById("editor-title").value = "First";
		document.getElementById("editor-title").dispatchEvent(new Event("input"));

		await vi.advanceTimersByTimeAsync(800);

		expect(createNote).toHaveBeenCalledWith(expect.objectContaining({title: "First", note_type: "text"}));
		expect(updateNote).not.toHaveBeenCalled();
	});

	it("updates the URL to the new note's id after the first save", async () => {
		createNote.mockResolvedValue({id: "n2", title: "First", word_count: 1});

		await renderEditor({id: "new"});
		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		expect(location.hash).toBe("#/note/n2");
	});
});

describe("renderEditor autosave debounce", () => {
	it("does not save immediately on a single keystroke", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});

		document.getElementById("editor-title").dispatchEvent(new Event("input"));

		expect(updateNote).not.toHaveBeenCalled();
	});

	it("saves once after the debounce delay elapses", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", title: "Edited", word_count: 1});

		await renderEditor({id: "n1"});
		document.getElementById("editor-title").value = "Edited";
		document.getElementById("editor-title").dispatchEvent(new Event("input"));

		await vi.advanceTimersByTimeAsync(800);

		expect(updateNote).toHaveBeenCalledOnce();
		expect(document.getElementById("save-status").textContent).toBe("Saved");
	});

	it("shows an error status without throwing if the save fails", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockRejectedValue(new Error("offline"));

		await renderEditor({id: "n1"});
		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		expect(document.getElementById("save-status").textContent).toContain("Error saving");
	});
});

describe("renderEditor cleanup", () => {
	it("destroys the TipTap editor and restores the nav on cleanup", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", title: "", word_count: 0});

		const cleanup = await renderEditor({id: "n1"});
		const editorInstance = lastEditorInstance;
		await cleanup();

		expect(editorInstance.destroy).toHaveBeenCalledOnce();
		expect(setNavCollapsed).toHaveBeenCalledWith(false);
	});

	it("flushes a pending autosave on cleanup instead of dropping the edit", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", title: "Late edit", word_count: 2});

		const cleanup = await renderEditor({id: "n1"});
		document.getElementById("editor-title").value = "Late edit";
		document.getElementById("editor-title").dispatchEvent(new Event("input"));

		// Navigate away before the debounce window elapses.
		await cleanup();

		expect(updateNote).toHaveBeenCalledOnce();
	});
});

describe("renderEditor link autolinking", () => {
	it("configures the Link extension with autolink and paste detection, and without click-to-navigate while editing", async () => {
		const Link = (await import("@tiptap/extension-link")).default;
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});

		await renderEditor({id: "n1"});

		expect(Link.configure).toHaveBeenCalledWith(
			expect.objectContaining({autolink: true, linkOnPaste: true, openOnClick: false}),
		);
	});
});

describe("renderEditor tags field", () => {
	it("passes the note's existing tags and its id to renderTagsField", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", tags: [{id: "t1", name: "x"}]});

		await renderEditor({id: "n1"});

		expect(renderTagsField).toHaveBeenCalledWith(expect.any(HTMLElement), "n1", [{id: "t1", name: "x"}]);
	});

	it("passes null noteId for a brand-new, unsaved note", async () => {
		await renderEditor({id: "new"});
		expect(renderTagsField).toHaveBeenCalledWith(expect.any(HTMLElement), null, []);
	});

	it("re-initialises the tags field with the real id after the first save", async () => {
		createNote.mockResolvedValue({id: "n2", title: "First", word_count: 1, tags: []});

		await renderEditor({id: "new"});
		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		const secondCall = renderTagsField.mock.calls.at(-1);
		expect(secondCall[1]).toBe("n2");
	});
});

describe("renderEditor attachments field", () => {
	it("passes the note's existing attachments and its id to renderAttachmentsField", async () => {
		getNote.mockResolvedValue({
			id: "n1",
			title: "",
			body: "",
			attachments: [{id: "a1", file_type: "image", processing_status: "complete"}],
		});

		await renderEditor({id: "n1"});

		expect(renderAttachmentsField).toHaveBeenCalledWith(
			expect.any(HTMLElement),
			"n1",
			[{id: "a1", file_type: "image", processing_status: "complete"}],
			{onImageUploaded: expect.any(Function)},
		);
	});

	it("passes null noteId and an empty list for a brand-new, unsaved note", async () => {
		await renderEditor({id: "new"});
		expect(renderAttachmentsField).toHaveBeenCalledWith(expect.any(HTMLElement), null, [], {
			onImageUploaded: expect.any(Function),
		});
	});

	it("re-initialises the attachments field with the real id after the first save", async () => {
		createNote.mockResolvedValue({id: "n2", title: "First", word_count: 1, attachments: []});

		await renderEditor({id: "new"});
		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		const secondCall = renderAttachmentsField.mock.calls.at(-1);
		expect(secondCall[1]).toBe("n2");
	});

	it("calls the attachments field's cleanup function on unmount", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", attachments: []});
		updateNote.mockResolvedValue({id: "n1", word_count: 0});
		const attachmentsCleanupFn = vi.fn();
		renderAttachmentsField.mockReturnValueOnce(attachmentsCleanupFn);

		const cleanup = await renderEditor({id: "n1"});
		await cleanup();

		expect(attachmentsCleanupFn).toHaveBeenCalledOnce();
	});
});

describe("renderEditor favourite button", () => {
	it("reflects the note's is_favourite state on load", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", is_favourite: true});
		await renderEditor({id: "n1"});
		expect(document.getElementById("favourite-btn").getAttribute("aria-pressed")).toBe("true");
	});

	it("is disabled for a new unsaved note", async () => {
		await renderEditor({id: "new"});
		expect(document.getElementById("favourite-btn").disabled).toBe(true);
	});

	it("clicking it PATCHes only is_favourite, not title/body, and does not go through the debounce", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", is_favourite: false});
		updateNote.mockResolvedValue({id: "n1", title: "", is_favourite: true});

		await renderEditor({id: "n1"});
		document.getElementById("favourite-btn").dispatchEvent(new MouseEvent("click"));
		await Promise.resolve();
		await Promise.resolve();

		expect(updateNote).toHaveBeenCalledWith("n1", {is_favourite: true});
	});

	it("reverts the optimistic toggle if the save fails", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", is_favourite: false});
		updateNote.mockRejectedValue(new Error("offline"));

		await renderEditor({id: "n1"});
		const btn = document.getElementById("favourite-btn");
		btn.dispatchEvent(new MouseEvent("click"));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(btn.getAttribute("aria-pressed")).toBe("false");
	});
});

describe("renderEditor nav refresh after save", () => {
	it("dispatches echo:note-saved after a successful autosave", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", title: "x", word_count: 1});
		const handler = vi.fn();
		window.addEventListener("echo:note-saved", handler);

		await renderEditor({id: "n1"});
		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		expect(handler).toHaveBeenCalledOnce();
		window.removeEventListener("echo:note-saved", handler);
	});

	it("dispatches echo:note-saved after a successful favourite toggle too", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", is_favourite: false});
		updateNote.mockResolvedValue({id: "n1", is_favourite: true});
		const handler = vi.fn();
		window.addEventListener("echo:note-saved", handler);

		await renderEditor({id: "n1"});
		document.getElementById("favourite-btn").dispatchEvent(new MouseEvent("click"));
		await Promise.resolve();
		await Promise.resolve();

		expect(handler).toHaveBeenCalledOnce();
		window.removeEventListener("echo:note-saved", handler);
	});
});

describe("renderEditor right panel collapse", () => {
	it("initialises the collapsible panel for #right-panel on mount", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		expect(lastCollapsiblePanelInstance.init).toHaveBeenCalledOnce();
	});

	it("destroys the collapsible panel on cleanup per mount", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", word_count: 0});
		const cleanup = await renderEditor({id: "n1"});
		const panelInstance = lastCollapsiblePanelInstance;
		await cleanup();
		expect(panelInstance.destroy).toHaveBeenCalledOnce();
	});

	it("passes an onPendingCountChange callback to renderRightPanel that updates the badge", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});

		const {onPendingCountChange} = renderRightPanel.mock.calls[0][2];
		onPendingCountChange(3);

		const badge = document.getElementById("right-panel-badge");
		expect(badge.hidden).toBe(false);
		expect(badge.textContent).toBe("3");
	});

	it("hides the badge again when the pending count drops to 0", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});

		const {onPendingCountChange} = renderRightPanel.mock.calls[0][2];
		onPendingCountChange(2);
		onPendingCountChange(0);

		expect(document.getElementById("right-panel-badge").hidden).toBe(true);
	});

	it("still initialises the collapsible panel for a brand-new, unsaved note", async () => {
		await renderEditor({id: "new"});
		expect(lastCollapsiblePanelInstance.init).toHaveBeenCalledOnce();
	});

	it("forces the panel collapsed by default on mount", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		expect(lastCollapsiblePanelInstance.setForceCollapsed).toHaveBeenCalledWith(true);
	});
});

function fireKeydown({key, ctrlKey = false, metaKey = false} = {}) {
	document.dispatchEvent(new KeyboardEvent("keydown", {key, ctrlKey, metaKey, bubbles: true, cancelable: true}));
}

describe("renderEditor Ctrl+S saves immediately, skipping the debounce", () => {
	it("flushes a pending debounced save right away", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", word_count: 1});
		await renderEditor({id: "n1"});

		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		fireKeydown({key: "s", ctrlKey: true});
		await Promise.resolve();
		await Promise.resolve();

		expect(updateNote).toHaveBeenCalledOnce();
		updateNote.mockClear();
		await vi.advanceTimersByTimeAsync(800);
		expect(updateNote).not.toHaveBeenCalled();
	});

	it("force-creates a brand-new, unsaved note immediately rather than waiting for the debounce", async () => {
		createNote.mockResolvedValue({id: "n2", title: "", word_count: 0});
		await renderEditor({id: "new"});

		fireKeydown({key: "s", ctrlKey: true});
		await Promise.resolve();
		await Promise.resolve();

		expect(createNote).toHaveBeenCalledOnce();
	});
});

describe("renderEditor Ctrl+D toggles favourite", () => {
	it("clicks the favourite button", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", is_favourite: false});
		updateNote.mockResolvedValue({id: "n1", is_favourite: true});
		await renderEditor({id: "n1"});

		fireKeydown({key: "d", ctrlKey: true});
		await Promise.resolve();
		await Promise.resolve();

		expect(updateNote).toHaveBeenCalledWith("n1", {is_favourite: true});
	});

	it("does nothing while the favourite button is disabled", async () => {
		await renderEditor({id: "new"});
		fireKeydown({key: "d", ctrlKey: true});
		await Promise.resolve();
		expect(updateNote).not.toHaveBeenCalled();
	});
});

describe("renderEditor Ctrl+Backspace moves the note to trash", () => {
	it("calls deleteNote and navigates to the notes list", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		deleteNote.mockResolvedValue();
		await renderEditor({id: "n1"});

		fireKeydown({key: "Backspace", ctrlKey: true});
		await Promise.resolve();
		await Promise.resolve();

		expect(deleteNote).toHaveBeenCalledWith("n1");
		expect(location.hash).toBe("#/list");
	});

	it("does not re-save the note during cleanup after it's been trashed via the shortcut", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		deleteNote.mockResolvedValue();
		const cleanup = await renderEditor({id: "n1"});

		fireKeydown({key: "Backspace", ctrlKey: true});
		await Promise.resolve();
		await Promise.resolve();

		updateNote.mockClear();
		await cleanup();
		expect(updateNote).not.toHaveBeenCalled();
	});

	it("does nothing for a brand-new, unsaved note", async () => {
		await renderEditor({id: "new"});
		fireKeydown({key: "Backspace", ctrlKey: true});
		await Promise.resolve();
		expect(deleteNote).not.toHaveBeenCalled();
	});
});

describe("renderEditor editor-scoped shortcut listener cleanup", () => {
	it("removes its keydown listener on unmount, so it doesn't fire after leaving the page", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", word_count: 0});
		const cleanup = await renderEditor({id: "n1"});
		await cleanup();

		updateNote.mockClear();
		fireKeydown({key: "d", ctrlKey: true});
		await Promise.resolve();

		expect(updateNote).not.toHaveBeenCalled();
	});
});

describe("renderEditor inline image embedding", () => {
	it("passes an onImageUploaded callback to attachments-field that inserts the image at the cursor via setImage", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", attachments: []});
		await renderEditor({id: "n1"});

		const onImageUploaded = renderAttachmentsField.mock.calls.at(-1)[3].onImageUploaded;
		onImageUploaded({id: "img1", generated_caption: "a red bicycle"});

		expect(lastEditorInstance.chainable.setImage).toHaveBeenCalledWith({
			src: "http://127.0.0.1:8000/attachments/img1/file",
			alt: "a red bicycle",
			attachmentId: "img1",
		});
		expect(lastEditorInstance.chainable.run).toHaveBeenCalledOnce();
	});

	it("falls back to an empty alt when the image has no caption yet", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: "", attachments: []});
		await renderEditor({id: "n1"});

		const onImageUploaded = renderAttachmentsField.mock.calls.at(-1)[3].onImageUploaded;
		onImageUploaded({id: "img1"});

		expect(lastEditorInstance.chainable.setImage).toHaveBeenCalledWith(expect.objectContaining({alt: ""}));
	});
});

describe("renderEditor orphaned image cleanup on save", () => {
	it("does not call deleteAttachment when no images have been removed", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		updateNote.mockResolvedValue({id: "n1", word_count: 0});
		lastEditorInstance = null;
		await renderEditor({id: "n1"});
		lastEditorInstance.__imageNodes = [{type: {name: "image"}, attrs: {attachmentId: "img1"}}];

		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		expect(deleteAttachment).not.toHaveBeenCalled();
	});

	it("calls deleteAttachment for an image present on load but missing from the content by save time", async () => {
		deleteAttachment.mockResolvedValue();
		getNote.mockResolvedValue({
			id: "n1",
			title: "",
			body: '<img data-attachment-id="img1">',
			attachments: [],
		});
		updateNote.mockResolvedValue({id: "n1", word_count: 0});

		const originalEditorMock = (await import("@tiptap/core")).Editor;
		originalEditorMock.mockImplementationOnce(function (config) {
			const chainable = {focus: vi.fn(() => chainable), setImage: vi.fn(() => chainable), run: vi.fn()};
			const instance = {
				config,
				destroy: vi.fn(),
				getHTML: vi.fn().mockReturnValue("<p>mock html</p>"),
				chain: vi.fn(() => chainable),
				chainable,
				__imageNodes: [{type: {name: "image"}, attrs: {attachmentId: "img1"}}],
				state: {
					doc: {
						descendants: vi.fn((cb) => {
							for (const n of instance.__imageNodes) cb(n);
						}),
					},
				},
			};
			lastEditorInstance = instance;
			return instance;
		});

		await renderEditor({id: "n1"});
		lastEditorInstance.__imageNodes = [];

		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		expect(deleteAttachment).toHaveBeenCalledWith("n1", "img1");
	});

	it("does not call deleteAttachment for a brand-new, unsaved note (nothing to clean up server-side yet)", async () => {
		await renderEditor({id: "new"});
		lastEditorInstance.__imageNodes = [];

		document.getElementById("editor-title").dispatchEvent(new Event("input"));
		await vi.advanceTimersByTimeAsync(800);

		expect(deleteAttachment).not.toHaveBeenCalled();
	});
});

function spyOnAnchorClick() {
	const calls = [];
	const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
		calls.push({href: this.href, target: this.target, rel: this.rel});
	});
	return {clickSpy, calls};
}

describe("renderEditor ctrl-click opens a link", () => {
	function fakeClickEvent({ctrlKey = true, metaKey = false, target} = {}) {
		return {
			ctrlKey,
			metaKey,
			target,
			preventDefault: vi.fn(),
		};
	}

	it("opens the link via a real anchor click when ctrl-clicked", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		const {calls} = spyOnAnchorClick();

		const anchor = document.createElement("a");
		anchor.href = "https://example.com/";
		const event = fakeClickEvent({target: anchor});

		const handled = lastEditorInstance.config.editorProps.handleClick(null, null, event);
		await Promise.resolve();

		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(handled).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			href: "https://example.com/",
			target: "_blank",
			rel: "noopener noreferrer",
		});
	});

	it("does nothing on a plain click with no modifier", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		const {calls} = spyOnAnchorClick();

		const anchor = document.createElement("a");
		anchor.href = "https://example.com/";
		const event = fakeClickEvent({ctrlKey: false, target: anchor});

		const handled = lastEditorInstance.config.editorProps.handleClick(null, null, event);

		expect(handled).toBe(false);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(calls).toHaveLength(0);
	});

	it("Ctrl alone does not open the link", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		const {calls} = spyOnAnchorClick();

		const anchor = document.createElement("a");
		anchor.href = "https://example.com/";
		const event = fakeClickEvent({ctrlKey: false, metaKey: true, target: anchor});

		const handled = lastEditorInstance.config.editorProps.handleClick(null, null, event);

		expect(handled).toBe(false);
		expect(calls).toHaveLength(0);
	});

	it("does nothing when the modifier is held but the click wasn't on a link", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		const {calls} = spyOnAnchorClick();

		const paragraph = document.createElement("p");
		const event = fakeClickEvent({target: paragraph});

		const handled = lastEditorInstance.config.editorProps.handleClick(null, null, event);

		expect(handled).toBe(false);
		expect(calls).toHaveLength(0);
	});
});

describe("renderEditor ctrl-click inside Tauri app", () => {
	function fakeClickEvent({ctrlKey = true, target} = {}) {
		return {ctrlKey, metaKey: false, target, preventDefault: vi.fn()};
	}

	beforeEach(() => {
		window.__TAURI__ = {};
	});

	afterEach(() => {
		delete window.__TAURI__;
	});

	it("opens via @tauri-apps/plugin-shell when available, without falling back to an anchor click", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		const {open} = await import("@tauri-apps/plugin-shell");
		open.mockResolvedValue();
		const {calls} = spyOnAnchorClick();

		const anchor = document.createElement("a");
		anchor.href = "https://example.com/";
		lastEditorInstance.config.editorProps.handleClick(null, null, fakeClickEvent({target: anchor}));
		await vi.advanceTimersByTimeAsync(0);

		expect(open).toHaveBeenCalledWith("https://example.com/");
		expect(calls).toHaveLength(0);
	});

	it("falls back to a real anchor click if the plugin-shell open() fails", async () => {
		getNote.mockResolvedValue({id: "n1", title: "", body: ""});
		await renderEditor({id: "n1"});
		const {open} = await import("@tauri-apps/plugin-shell");
		open.mockRejectedValue(new Error("capability not granted"));
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const {calls} = spyOnAnchorClick();

		const anchor = document.createElement("a");
		anchor.href = "https://example.com/";
		lastEditorInstance.config.editorProps.handleClick(null, null, fakeClickEvent({target: anchor}));
		await vi.advanceTimersByTimeAsync(0);

		expect(warnSpy).toHaveBeenCalled();
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({href: "https://example.com/", target: "_blank"});
	});
});
