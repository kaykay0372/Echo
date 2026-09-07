export function createConfirmButton({
	button,
	statusEl,
	idleText,
	armedText,
	idleLabel,
	armedLabel,
	armedMessage,
	revertMessage,
	revertMs = 4000,
	onConfirm,
	onError,
}) {
	let confirming = false;
	let revertTimer = null;

	function applyIdle() {
		button.textContent = idleText;
		if (idleLabel) {
			button.setAttribute("aria-label", idleLabel);
		} else {
			button.removeAttribute("aria-label");
		}
	}

	function armDelete() {
		confirming = true;
		button.textContent = armedText;
		if (armedLabel) button.setAttribute("aria-label", armedLabel);
		if (statusEl) statusEl.textContent = armedMessage;
		revertTimer = setTimeout(() => disarmDelete({announce: true}), revertMs);
	}

	function disarmDelete({announce = false} = {}) {
		confirming = false;
		applyIdle();
		if (statusEl) statusEl.textContent = announce ? revertMessage : "";
	}

	applyIdle();

	button.addEventListener("click", async () => {
		if (!confirming) {
			armDelete();
			return;
		}
		clearTimeout(revertTimer);
		try {
			await onConfirm();
		} catch (err) {
			disarmDelete();
			onError?.(err);
		}
	});

	return {disarmDelete};
}
