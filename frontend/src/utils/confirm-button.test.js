import {beforeEach, afterEach, describe, expect, it, vi} from "vitest";
import {createConfirmButton} from "./confirm-button.js";

function renderFixture() {
	document.body.innerHTML = `
		<button id="delete-btn"></button>
		<span id="status" aria-live="assertive"></span>
	`;
}

function makeButton(overrides = {}) {
	return createConfirmButton({
		button: document.getElementById("delete-btn"),
		statusEl: document.getElementById("status"),
		idleText: "Delete forever",
		armedText: "Confirm delete?",
		armedMessage: "Press again to confirm.",
		revertMessage: "Delete cancelled.",
		onConfirm: vi.fn(),
		...overrides,
	});
}

beforeEach(() => {
	renderFixture();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("createConfirmButton arm/disarm", () => {
	it("starts with the idle text and no aria-label by default", () => {
		makeButton();
		const btn = document.getElementById("delete-btn");
		expect(btn.textContent).toBe("Delete forever");
		expect(btn.hasAttribute("aria-label")).toBe(false);
	});

	it("first click arms the button and announces the pending state", () => {
		makeButton();
		document.getElementById("delete-btn").click();

		expect(document.getElementById("delete-btn").textContent).toBe("Confirm delete?");
		expect(document.getElementById("status").textContent).toBe("Press again to confirm.");
	});

	it("second click within the window calls onConfirm", () => {
		const onConfirm = vi.fn();
		makeButton({onConfirm});
		const btn = document.getElementById("delete-btn");

		btn.click();
		btn.click();

		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("auto-reverts after revertMs and announces the cancellation", () => {
		makeButton();
		document.getElementById("delete-btn").click();

		vi.advanceTimersByTime(4000);

		expect(document.getElementById("delete-btn").textContent).toBe("Delete forever");
		expect(document.getElementById("status").textContent).toBe("Delete cancelled.");
	});

	it("a second click after the revert window arms again instead of confirming", () => {
		const onConfirm = vi.fn();
		makeButton({onConfirm});
		const btn = document.getElementById("delete-btn");

		btn.click();
		vi.advanceTimersByTime(4000);
		btn.click();

		expect(onConfirm).not.toHaveBeenCalled();
		expect(btn.textContent).toBe("Confirm delete?");
	});
});

describe("createConfirmButton aria-label handling", () => {
	it("sets idleLabel immediately if provided", () => {
		makeButton({idleLabel: "Delete tag test"});
		expect(document.getElementById("delete-btn").getAttribute("aria-label")).toBe("Delete tag test");
	});

	it("swaps to armedLabel while armed and back to idleLabel on revert", () => {
		makeButton({idleLabel: "Delete tag test", armedLabel: "Confirm deleting tag test"});
		const btn = document.getElementById("delete-btn");

		btn.click();
		expect(btn.getAttribute("aria-label")).toBe("Confirm deleting tag test");

		vi.advanceTimersByTime(4000);
		expect(btn.getAttribute("aria-label")).toBe("Delete tag test");
	});
});

describe("createConfirmButton error handling", () => {
	it("disarms and calls onError if onConfirm rejects", async () => {
		const onError = vi.fn();
		const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
		makeButton({onConfirm, onError});
		const btn = document.getElementById("delete-btn");

		btn.click();
		btn.click();
		await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

		expect(btn.textContent).toBe("Delete forever");
		expect(document.getElementById("status").textContent).toBe("");
	});
});

describe("createConfirmButton disarmDelete() returned for external use", () => {
	it("can be called directly to reset the button early", () => {
		const confirmBtn = makeButton();
		document.getElementById("delete-btn").click();

		confirmBtn.disarmDelete();

		expect(document.getElementById("delete-btn").textContent).toBe("Delete forever");
	});
});
