export function debounce(func, delayMs) {
	let timeoutId = null;

	function debounced(...args) {
		if (timeoutId !== null) clearTimeout(timeoutId);
		timeoutId = setTimeout(() => {
			timeoutId = null;
			func(...args);
		}, delayMs);
	}

	debounced.cancel = () => {
		if (timeoutId !== null) clearTimeout(timeoutId);
		timeoutId = null;
	};

	return debounced;
}
