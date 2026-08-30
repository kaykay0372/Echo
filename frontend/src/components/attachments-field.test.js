import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../api/client.js", () => ({
	createAttachment: vi.fn(),
	deleteAttachment: vi.fn(),
	getAttachmentFileUrl: vi.fn((id) => `http://127.0.0.1:8000/attachments/${id}/file`),
	getNote: vi.fn(),
}));

import {createAttachment, deleteAttachment, getNote} from "../api/client.js";
import {renderAttachmentsField} from "./attachments-field.js";

let container;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("renderAttachmentsField no note saved yet", () => {
	it("shows a placeholder and does not render an add button when noteId is null", () => {
		renderAttachmentsField(container, null, []);
		expect(container.textContent).toContain("Save the note");
		expect(container.querySelector(".attachments-field-add-btn")).toBeNull();
	});
});

describe("renderAttachmentsField existing note, audio-only list", () => {
	it("renders a row per audio attachment", () => {
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "complete"}]);
		expect(container.querySelectorAll(".attachments-field-item")).toHaveLength(1);
	});

	it("does not render a row for an image attachment passed in initialAttachments (images live in the note content instead)", () => {
		renderAttachmentsField(container, "n1", [
			{id: "a1", file_type: "image", processing_status: "complete"},
			{id: "a2", file_type: "audio", processing_status: "complete"},
		]);
		expect(container.querySelectorAll(".attachments-field-item")).toHaveLength(1);
	});

	it("shows the generated transcript once processing completes", () => {
		renderAttachmentsField(container, "n1", [
			{
				id: "a1",
				file_type: "audio",
				processing_status: "complete",
				generated_transcript: "hello, this is a test recording",
			},
		]);
		const text = container.querySelector(".attachments-field-generated-text").textContent;
		expect(text).toContain("hello, this is a test recording");
	});

	it("shows a processing status for a pending attachment with no generated text yet", () => {
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "pending"}]);
		expect(container.querySelector(".attachments-field-status").textContent).toContain("Transcribing");
		expect(container.querySelector(".attachments-field-generated-text")).toBeNull();
	});

	it("applies the -failed status modifier class", () => {
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "failed"}]);
		const status = container.querySelector(".attachments-field-status");
		expect(status.classList.contains("attachments-field-status-failed")).toBe(true);
	});

	it("does not restrict file selection via accept", () => {
		renderAttachmentsField(container, "n1", []);
		const fileInput = container.querySelector(".attachments-field-file-input");
		expect(fileInput.accept).toBe("");
	});

	it("shows an error message and re-enables Add if the upload fails", async () => {
		createAttachment.mockRejectedValue(new Error("network down"));
		renderAttachmentsField(container, "n1", []);

		const fileInput = container.querySelector(".attachments-field-file-input");
		const file = new File(["data"], "clip.mp3", {type: "audio/mpeg"});
		Object.defineProperty(fileInput, "files", {value: [file]});
		fileInput.dispatchEvent(new Event("change"));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.querySelector(".attachments-field-error").hidden).toBe(false);
		expect(container.querySelector(".attachments-field-error").textContent).toBe("Couldn't upload that file.");
		expect(container.querySelector(".attachments-field-add-btn").disabled).toBe(false);
	});

	it("shows a clear message for a 409 duplicate-content conflict", async () => {
		const err = new Error("Attachment upload 409: duplicate");
		err.status = 409;
		err.existingNoteId = "n1";
		createAttachment.mockRejectedValue(err);
		renderAttachmentsField(container, "n1", []);

		const fileInput = container.querySelector(".attachments-field-file-input");
		const file = new File(["data"], "clip.mp3", {type: "audio/mpeg"});
		Object.defineProperty(fileInput, "files", {value: [file]});
		fileInput.dispatchEvent(new Event("change"));
		await new Promise((r) => setTimeout(r, 0));

		expect(container.querySelector(".attachments-field-error").textContent).toBe(
			"This exact file is already attached to this note.",
		);
	});

	it("removing an attachment calls deleteAttachment and re-renders without it", async () => {
		deleteAttachment.mockResolvedValue();
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "complete"}]);

		container.querySelector(".attachments-field-remove").click();
		await new Promise((r) => setTimeout(r, 0));

		expect(deleteAttachment).toHaveBeenCalledWith("n1", "a1");
		expect(container.querySelectorAll(".attachments-field-item")).toHaveLength(0);
	});

	it("cleanup empties the container", () => {
		const cleanup = renderAttachmentsField(container, "n1", []);
		cleanup();
		expect(container.innerHTML).toBe("");
	});
});

describe("renderAttachmentsField image uploads route to onImageUploaded instead of the list", () => {
	it("calls onImageUploaded with the new attachment and does not add a list row", async () => {
		createAttachment.mockResolvedValue({id: "img1", file_type: "image", processing_status: "pending"});
		const onImageUploaded = vi.fn();
		renderAttachmentsField(container, "n1", [], {onImageUploaded});

		const fileInput = container.querySelector(".attachments-field-file-input");
		const file = new File(["data"], "photo.png", {type: "image/png"});
		Object.defineProperty(fileInput, "files", {value: [file]});
		fileInput.dispatchEvent(new Event("change"));
		await new Promise((r) => setTimeout(r, 0));

		expect(onImageUploaded).toHaveBeenCalledWith({id: "img1", file_type: "image", processing_status: "pending"});
		expect(container.querySelectorAll(".attachments-field-item")).toHaveLength(0);
	});

	it("does not throw if onImageUploaded wasn't provided", async () => {
		createAttachment.mockResolvedValue({id: "img1", file_type: "image", processing_status: "pending"});
		renderAttachmentsField(container, "n1", []);

		const fileInput = container.querySelector(".attachments-field-file-input");
		const file = new File(["data"], "photo.png", {type: "image/png"});
		Object.defineProperty(fileInput, "files", {value: [file]});

		await expect(async () => {
			fileInput.dispatchEvent(new Event("change"));
			await new Promise((r) => setTimeout(r, 0));
		}).not.toThrow();
	});
});

describe("renderAttachmentsField polling only concerns itself with audio", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it("polls getNote on an interval while an audio attachment is pending", async () => {
		getNote.mockResolvedValue({
			id: "n1",
			attachments: [{id: "a1", file_type: "audio", processing_status: "pending"}],
		});
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "pending"}]);

		await vi.advanceTimersByTimeAsync(5000);

		expect(getNote).toHaveBeenCalledWith("n1");
	});

	it("stops polling and reflects the result once processing completes", async () => {
		getNote.mockResolvedValue({
			id: "n1",
			attachments: [
				{
					id: "a1",
					file_type: "audio",
					processing_status: "complete",
					generated_transcript: "a short voice memo",
				},
			],
		});
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "pending"}]);

		await vi.advanceTimersByTimeAsync(5000);
		expect(container.querySelector(".attachments-field-generated-text").textContent).toContain(
			"a short voice memo",
		);

		getNote.mockClear();
		await vi.advanceTimersByTimeAsync(5000);
		expect(getNote).not.toHaveBeenCalled();
	});

	it("does not poll when every audio attachment already finished processing", async () => {
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "audio", processing_status: "complete"}]);

		await vi.advanceTimersByTimeAsync(5000);

		expect(getNote).not.toHaveBeenCalled();
	});

	it("does not poll on load for a pending image", async () => {
		renderAttachmentsField(container, "n1", [{id: "a1", file_type: "image", processing_status: "pending"}]);

		await vi.advanceTimersByTimeAsync(5000);

		expect(getNote).not.toHaveBeenCalled();
	});

	it("stops the poll loop on cleanup", async () => {
		getNote.mockResolvedValue({
			id: "n1",
			attachments: [{id: "a1", file_type: "audio", processing_status: "pending"}],
		});
		const cleanup = renderAttachmentsField(container, "n1", [
			{id: "a1", file_type: "audio", processing_status: "pending"},
		]);

		cleanup();
		getNote.mockClear();
		await vi.advanceTimersByTimeAsync(10000);

		expect(getNote).not.toHaveBeenCalled();
	});
});
