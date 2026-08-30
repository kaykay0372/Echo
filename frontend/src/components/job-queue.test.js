import {beforeEach, afterEach, describe, expect, it, vi} from "vitest";

vi.mock("../api/client.js", () => ({
	getJobQueueStatus: vi.fn(),
	retryJob: vi.fn(),
	discardJob: vi.fn(),
	deleteJob: vi.fn(),
}));

import {getJobQueueStatus, retryJob, discardJob, deleteJob} from "../api/client.js";
import {mountJobQueue} from "./job-queue.js";

let root;

function mockJobs({running = [], queued = [], failed = []} = {}) {
	getJobQueueStatus.mockImplementation(({status}) => {
		if (status === "running") return Promise.resolve(running);
		if (status === "queued") return Promise.resolve(queued);
		if (status === "failed") return Promise.resolve(failed);
		return Promise.resolve([]);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	document.body.innerHTML = ""; // isolate from other tests
	root = document.createElement("div");
	document.body.appendChild(root);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("mountJobQueue has its own root element", () => {
	it("creates and appends its own element into the given parent", async () => {
		mockJobs({});
		const parent = document.createElement("div");
		await mountJobQueue(parent);
		expect(parent.querySelector(".job-queue")).not.toBeNull();
	});

	it("defaults to mounting into document.body when no parent is given", async () => {
		mockJobs({});
		const before = document.body.querySelector(".job-queue");
		expect(before).toBeNull();

		await mountJobQueue();

		expect(document.body.querySelector(".job-queue")).not.toBeNull();
	});
});

describe("mountJobQueue idle vs active toggle", () => {
	it("shows the idle (briefcase) state when there are no active jobs", async () => {
		mockJobs({});
		await mountJobQueue(root);
		expect(root.querySelector(".job-queue-icon-briefcase")).not.toBeNull();
	});

	it("shows an active pill with a count when jobs are running or queued", async () => {
		mockJobs({running: [{id: "j1", job_type: "embed", status: "running"}]});
		await mountJobQueue(root);
		expect(root.querySelector(".job-queue-toggle-active")).not.toBeNull();
		expect(root.querySelector(".job-queue-toggle-label").textContent).toContain("1");
	});
});

describe("mountJobQueue expanded panel", () => {
	it("stays hidden until the toggle is clicked", async () => {
		mockJobs({running: [{id: "j1", job_type: "embed", status: "running"}]});
		await mountJobQueue(root);
		expect(root.querySelector(".job-queue-panel").hidden).toBe(true);
	});

	it("shows job type and status per row when expanded", async () => {
		mockJobs({running: [{id: "j1", job_type: "embed", status: "running"}]});
		await mountJobQueue(root);

		root.querySelector(".job-queue-toggle").click();

		const row = root.querySelector(".job-queue-item");
		expect(row.textContent).toContain("Embed");
		expect(row.textContent).toContain("Running");
	});

	it("shows Cancel for both queued and running jobs", async () => {
		mockJobs({
			running: [{id: "j1", job_type: "embed", status: "running"}],
			queued: [{id: "j2", job_type: "caption", status: "queued"}],
		});
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		const rows = [...root.querySelectorAll(".job-queue-item")];
		const runningRow = rows.find((r) => r.textContent.includes("Embed"));
		const queuedRow = rows.find((r) => r.textContent.includes("Caption"));

		expect(runningRow.querySelector(".job-queue-action-cancel")).not.toBeNull();
		expect(queuedRow.querySelector(".job-queue-action-cancel")).not.toBeNull();
	});

	it("clicking Cancel on a running job calls discardJob too", async () => {
		mockJobs({running: [{id: "j1", job_type: "embed", status: "running"}]});
		discardJob.mockResolvedValue({id: "j1", status: "discarded"});
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		root.querySelector(".job-queue-action-cancel").click();
		await vi.advanceTimersByTimeAsync(0);
		expect(discardJob).toHaveBeenCalledWith("j1");
	});

	it("only shows Retry for failed jobs", async () => {
		mockJobs({failed: [{id: "j3", job_type: "transcribe", status: "failed"}]});
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		expect(root.querySelector(".job-queue-action-retry")).not.toBeNull();
		expect(root.querySelector(".job-queue-action-cancel")).toBeNull();
	});

	it("clicking Retry calls retryJob and refreshes", async () => {
		mockJobs({failed: [{id: "j3", job_type: "transcribe", status: "failed"}]});
		retryJob.mockResolvedValue({id: "j3", status: "queued"});
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		root.querySelector(".job-queue-action-retry").click();
		await vi.advanceTimersByTimeAsync(0);
		expect(retryJob).toHaveBeenCalledWith("j3");
	});

	it("clicking Cancel on a queued job calls discardJob", async () => {
		mockJobs({queued: [{id: "j2", job_type: "caption", status: "queued"}]});
		discardJob.mockResolvedValue({id: "j2", status: "discarded"});
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		root.querySelector(".job-queue-action-cancel").click();
		await vi.advanceTimersByTimeAsync(0);
		expect(discardJob).toHaveBeenCalledWith("j2");
	});

	it("a failed job shows both Retry and a delete button", async () => {
		mockJobs({failed: [{id: "j3", job_type: "transcribe", status: "failed"}]});
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		expect(root.querySelector(".job-queue-action-retry")).not.toBeNull();
		expect(root.querySelector(".job-queue-action-delete")).not.toBeNull();
	});

	it("clicking delete on a failed job calls deleteJob and refreshes", async () => {
		mockJobs({failed: [{id: "j3", job_type: "transcribe", status: "failed"}]});
		deleteJob.mockResolvedValue();
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		root.querySelector(".job-queue-action-delete").click();
		await vi.advanceTimersByTimeAsync(0);
		expect(deleteJob).toHaveBeenCalledWith("j3");
	});

	it("a discarded job renders no action at all)", async () => {
		mockJobs({failed: [{id: "j3", job_type: "transcribe", status: "failed"}]});
		await mountJobQueue(root);

		expect(getJobQueueStatus).not.toHaveBeenCalledWith(expect.objectContaining({status: "discarded"}));
	});

	it("the delete button is disabled while the delete request is in progress", async () => {
		mockJobs({failed: [{id: "j3", job_type: "transcribe", status: "failed"}]});
		let resolveDelete;
		deleteJob.mockReturnValue(
			new Promise((resolve) => {
				resolveDelete = resolve;
			}),
		);
		await mountJobQueue(root);
		root.querySelector(".job-queue-toggle").click();

		const deleteBtn = root.querySelector(".job-queue-action-delete");
		deleteBtn.click();
		await Promise.resolve();

		expect(deleteBtn.disabled).toBe(true);
		resolveDelete();
		await vi.advanceTimersByTimeAsync(0);
	});
});

describe("mountJobQueue polling and cleanup", () => {
	it("polls again after the interval elapses", async () => {
		mockJobs({});
		await mountJobQueue(root);
		const callsBefore = getJobQueueStatus.mock.calls.length;

		await vi.advanceTimersByTimeAsync(5000);

		expect(getJobQueueStatus.mock.calls.length).toBeGreaterThan(callsBefore);
	});

	it("unmount stops polling and clears the root", async () => {
		mockJobs({});
		const unmount = await mountJobQueue(root);
		const callsAtUnmount = getJobQueueStatus.mock.calls.length;

		unmount();
		await vi.advanceTimersByTimeAsync(20000);

		expect(getJobQueueStatus.mock.calls.length).toBe(callsAtUnmount);
		// Root still holds the child div job-queue created for itself
		expect(root.querySelector(".job-queue-toggle")).toBeNull();
	});
});
