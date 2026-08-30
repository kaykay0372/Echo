// Three independent things that want a panel collapsed:
//   1. Window too narrow to show an expanded panel without squeezing the
//      content area.
//   2. A page forcing collapse (e.g. the editor collapsing the nav).
//   3. The user's manually pinned preference (persisted).
export const NARROW_BREAKPOINT_PX = 860;

function readStoredBool(storageKeyPrefix, key, fallback) {
	try {
		const raw = window.localStorage.getItem(`${storageKeyPrefix}:${key}`);
		return raw === null ? fallback : raw === "true";
	} catch {
		return fallback;
	}
}

function writeStoredBool(storageKeyPrefix, key, value) {
	try {
		window.localStorage.setItem(`${storageKeyPrefix}:${key}`, String(value));
	} catch {
		// Non-fatal
	}
}

export function createCollapsiblePanel({
	panelId,
	toggleId,
	storageKeyPrefix,
	collapsedClass,
	pinnedClass,
	pinnedLabel,
	pinnedLabelActive,
}) {
	let forceCollapsed = false;
	let isNarrow = window.innerWidth < NARROW_BREAKPOINT_PX;
	let resizeListenerAttached = false;

	function panelElement() {
		return document.getElementById(panelId);
	}
	function toggleElement() {
		return document.getElementById(toggleId);
	}

	function apply() {
		const element = panelElement();
		if (!element) return;
		const shouldCollapse = forceCollapsed || isNarrow;
		element.classList.toggle(collapsedClass, shouldCollapse);

		// A manual pin never applies while the window is too narrow
		const pinned = !isNarrow && readStoredBool(storageKeyPrefix, "pinned", false);
		element.classList.toggle(pinnedClass, pinned);

		const btn = toggleElement();
		if (btn) {
			btn.setAttribute("aria-pressed", String(pinned));
			if (pinnedLabel) {
				btn.setAttribute("aria-label", pinned ? pinnedLabelActive || pinnedLabel : pinnedLabel);
			}
		}
	}

	function handleResize() {
		const nowNarrow = window.innerWidth < NARROW_BREAKPOINT_PX;
		if (nowNarrow !== isNarrow) {
			isNarrow = nowNarrow;
			apply();
		}
	}

	function init() {
		apply();

		// Only ever attach one listener per panel instance
		if (!resizeListenerAttached) {
			window.addEventListener("resize", handleResize);
			resizeListenerAttached = true;
		}

		// The toggle button is rendered fresh everytime the page reloads
		const btn = toggleElement();
		if (btn && !btn.dataset.collapsibleBound) {
			btn.dataset.collapsibleBound = "true";
			btn.addEventListener("click", () => {
				const wasPinned = btn.getAttribute("aria-pressed") === "true";
				writeStoredBool(storageKeyPrefix, "pinned", !wasPinned);
				apply();
				if (wasPinned) btn.blur();
			});
		}
	}

	return {
		init,
		setForceCollapsed(collapsed) {
			forceCollapsed = collapsed;
			apply();
		},
		destroy() {
			window.removeEventListener("resize", handleResize);
			resizeListenerAttached = false;
		},
	};
}
