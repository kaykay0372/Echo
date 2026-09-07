// Shared keyboard/ARIA wiring for the "input + listbox" search and tags pattern.
export function createActivedescendantList({input, getOptionEls, onActivate}) {
	let activeIndex = -1;

	function setActiveIndex(index) {
		const options = getOptionEls();
		if (options.length === 0) {
			activeIndex = -1;
			input.removeAttribute("aria-activedescendant");
			return;
		}
		activeIndex = ((index % options.length) + options.length) % options.length;
		options.forEach((opt, i) => opt.setAttribute("aria-selected", String(i === activeIndex)));
		const active = options[activeIndex];
		input.setAttribute("aria-activedescendant", active.id);
		active.scrollIntoView({block: "nearest"});
	}

	function resetActiveIndex() {
		activeIndex = -1;
		input.removeAttribute("aria-activedescendant");
	}

	function handleKey(event) {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex(activeIndex + 1);
				return true;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex(activeIndex - 1);
				return true;
			case "Home":
				event.preventDefault();
				setActiveIndex(0);
				return true;
			case "End":
				event.preventDefault();
				setActiveIndex(getOptionEls().length - 1);
				return true;
			case "Enter":
				if (activeIndex >= 0) {
					event.preventDefault();
					onActivate(activeIndex);
				}
				return true;
			default:
				return false;
		}
	}

	return {setActiveIndex, resetActiveIndex, handleKey};
}
