import {getJobQueueStatus, retryJob, discardJob, deleteJob} from "../api/client.js";

const POLL_INTERVAL_MS = 5000;

const JOB_TYPE_LABELS = {
	embed: "Embed",
	generate_links: "Find connections",
	caption: "Caption",
	ocr: "OCR",
	transcribe: "Transcribe",
};

// Owns its own root element rather than taking one as a parameter,
// so it can be mounted into the nav bar or elsewhere without needing
// to know the markup of the surrounding page
export function mountJobQueue(parent = document.body) {
	/* Mounts the job queue into the given parent element */
	const root = document.createElement("div");
	parent.appendChild(root);
	return mountInto(root);
}

async function mountInto(root) {
	root.innerHTML = "";
	root.className = "job-queue";

	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.className = "job-queue-toggle";
	toggle.setAttribute("aria-expanded", "false");
	toggle.setAttribute("aria-label", "Job queue");
	root.appendChild(toggle);

	const panel = document.createElement("div");
	panel.className = "job-queue-panel";
	panel.hidden = true;
	panel.setAttribute("role", "region");
	panel.setAttribute("aria-label", "Job queue details");
	panel.setAttribute("aria-live", "polite");
	root.appendChild(panel);

	let jobs = [];
	let expanded = false;
	let pollHandle = null;

	function renderToggle() {
		const running = jobs.filter((j) => j.status === "running");
		const queued = jobs.filter((j) => j.status === "queued");
		const active = running.length + queued.length;

		toggle.innerHTML = "";
		toggle.setAttribute("aria-expanded", String(expanded));

		if (active === 0) {
			toggle.classList.remove("job-queue-toggle-active");
			const icon = document.createElement("span");
			icon.className = "job-queue-icon job-queue-icon-briefcase";
			icon.setAttribute("aria-hidden", "true");
			toggle.appendChild(icon);
			toggle.setAttribute("aria-label", "Job queue: idle");
			return;
		}

		toggle.classList.add("job-queue-toggle-active");
		const spinner = document.createElement("span");
		spinner.className = "job-queue-spinner";
		spinner.setAttribute("aria-hidden", "true");
		toggle.appendChild(spinner);

		const label = document.createElement("span");
		label.className = "job-queue-toggle-label";
		label.textContent = `${active} ${active === 1 ? "job" : "jobs"}`;
		toggle.appendChild(label);
		toggle.setAttribute("aria-label", `Job queue: ${active} active`);
	}

	function renderPanel() {
		panel.innerHTML = "";

		const heading = document.createElement("div");
		heading.className = "job-queue-heading";
		heading.textContent = "Job queue";
		panel.appendChild(heading);

		if (jobs.length === 0) {
			const empty = document.createElement("p");
			empty.className = "job-queue-empty";
			empty.textContent = "No jobs running.";
			panel.appendChild(empty);
			return;
		}

		const list = document.createElement("ul");
		list.className = "job-queue-list";

		for (const job of jobs) {
			list.appendChild(buildJobRow(job));
		}

		panel.appendChild(list);
	}

	function buildJobRow(job) {
		const li = document.createElement("li");
		li.className = "job-queue-item";

		const info = document.createElement("div");
		info.className = "job-queue-item-info";

		const type = document.createElement("div");
		type.className = "job-queue-item-type";
		type.textContent = JOB_TYPE_LABELS[job.job_type] || job.job_type;
		info.appendChild(type);

		const status = document.createElement("div");
		status.className = `job-queue-item-status job-queue-item-status-${job.status}`;
		status.textContent = statusLabel(job.status);
		info.appendChild(status);

		if (job.status === "running") {
			const bar = document.createElement("div");
			bar.className = "job-queue-progress";
			const fill = document.createElement("div");
			fill.className = "job-queue-progress-fill";
			bar.appendChild(fill);
			info.appendChild(bar);
		}

		li.appendChild(info);

		if (job.status === "queued" || job.status === "running") {
			// "Cancel" maps to "discarding" a job.
			li.appendChild(
				actionButton("Cancel", "job-queue-action-cancel", li, async () => {
					await withRowDisabled(li, () => discardJob(job.id));
					await refresh();
				}),
			);
		} else if (job.status === "failed") {
			li.appendChild(
				actionButton("Retry", "job-queue-action-retry", li, async () => {
					await withRowDisabled(li, () => retryJob(job.id));
					await refresh();
				}),
			);
			li.appendChild(deleteButton(li, job));
		}

		return li;
	}

	// Restores focus to the panel position in the rebuilt list instead of <body>.
	function refocusAfterAction(rowIndex) {
		const rows = Array.from(panel.querySelectorAll(".job-queue-item"));
		const target =
			rows[rowIndex]?.querySelector("button:not([disabled])") ??
			rows[rowIndex - 1]?.querySelector("button:not([disabled])") ??
			toggle;
		target.focus();
	}

	function actionButton(label, className, row, onClick) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `job-queue-action ${className}`;
		btn.textContent = label;
		btn.addEventListener("click", async () => {
			const rowIndex = Array.from(row.parentElement?.children ?? []).indexOf(row);
			try {
				await onClick();
				refocusAfterAction(rowIndex);
			} catch (err) {
				console.error(`job-queue ${label.toLowerCase()} failed`, err);
			}
		});
		return btn;
	}

	function deleteButton(li, job) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "job-queue-action job-queue-action-delete";
		btn.textContent = "\u00d7";
		btn.setAttribute("aria-label", `Delete ${JOB_TYPE_LABELS[job.job_type] || job.job_type} job`);
		btn.addEventListener("click", async () => {
			const rowIndex = Array.from(li.parentElement?.children ?? []).indexOf(li);
			try {
				await withRowDisabled(li, () => deleteJob(job.id));
				await refresh();
				refocusAfterAction(rowIndex);
			} catch (err) {
				console.error("job-queue delete failed", err);
			}
		});
		return btn;
	}

	async function withRowDisabled(row, func) {
		row.querySelectorAll("button").forEach((b) => (b.disabled = true));
		try {
			await func();
		} finally {
			row.querySelectorAll("button").forEach((b) => (b.disabled = false));
		}
	}

	function statusLabel(status) {
		switch (status) {
			case "running":
				return "Running";
			case "queued":
				return "Queued";
			case "failed":
				return "Failed";
			case "complete":
				return "Complete";
			case "discarded":
				return "Cancelled";
			default:
				return status;
		}
	}

	async function refresh() {
		try {
			// Active + recently-failed jobs only
			const [active, running, failed] = await Promise.all([
				getJobQueueStatus({status: "queued", limit: 20}),
				getJobQueueStatus({status: "running", limit: 20}),
				getJobQueueStatus({status: "failed", limit: 10}),
			]);
			jobs = [...running, ...active, ...failed];
		} catch (err) {
			console.error("job-queue failed to refresh", err);
		}
		renderToggle();
		if (expanded) renderPanel();
	}

	toggle.addEventListener("click", () => {
		expanded = !expanded;
		panel.hidden = !expanded;
		toggle.setAttribute("aria-expanded", String(expanded));
		if (expanded) renderPanel();
	});

	await refresh();
	pollHandle = setInterval(refresh, POLL_INTERVAL_MS);

	return function unmount() {
		clearInterval(pollHandle);
		root.innerHTML = "";
	};
}
