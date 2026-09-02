import {setNavCollapsed} from "../components/nav.js";
import {getLinkAutoConfirm, setLinkAutoConfirm} from "../utils/link-behaviour.js";
import {mountTemplate} from "../utils/templates.js";

export function renderSettings() {
	/* Settings page is a single, static template with no dynamic data, aside from the auto-confirm toggle. */
	const content = document.getElementById("content");
	setNavCollapsed(false);

	mountTemplate(content, "settings-template");

	const manualBtn = content.querySelector('[data-link-mode="manual"]');
	const autoBtn = content.querySelector('[data-link-mode="auto"]');

	function applyState(autoConfirm) {
		manualBtn.setAttribute("aria-pressed", String(!autoConfirm));
		autoBtn.setAttribute("aria-pressed", String(autoConfirm));
	}

	applyState(getLinkAutoConfirm());

	manualBtn.addEventListener("click", () => {
		setLinkAutoConfirm(false);
		applyState(false);
	});
	autoBtn.addEventListener("click", () => {
		setLinkAutoConfirm(true);
		applyState(true);
	});

	return function cleanup() {};
}
