import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {debounce} from "./debounce.js";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("debounce", () => {
	it("does not call the function immediately", () => {
		const func = vi.fn();
		const debounced = debounce(func, 500);

		debounced();

		expect(func).not.toHaveBeenCalled();
	});

	it("calls the function once after the delay elapses", () => {
		const func = vi.fn();
		const debounced = debounce(func, 500);

		debounced();
		vi.advanceTimersByTime(500);

		expect(func).toHaveBeenCalledOnce();
	});

	it("resets the timer on repeated calls within the delay (rapid typing)", () => {
		const func = vi.fn();
		const debounced = debounce(func, 500);

		debounced();
		vi.advanceTimersByTime(300);
		debounced(); // resets the 500ms window
		vi.advanceTimersByTime(300);

		expect(func).not.toHaveBeenCalled();

		vi.advanceTimersByTime(200);

		expect(func).toHaveBeenCalledOnce();
	});

	it("passes the latest call's arguments through, not the first", () => {
		const func = vi.fn();
		const debounced = debounce(func, 500);

		debounced("first");
		debounced("second");
		vi.advanceTimersByTime(500);

		expect(func).toHaveBeenCalledWith("second");
		expect(func).toHaveBeenCalledOnce();
	});

	it("cancel() prevents a pending call from firing", () => {
		const func = vi.fn();
		const debounced = debounce(func, 500);

		debounced();
		debounced.cancel();
		vi.advanceTimersByTime(500);

		expect(func).not.toHaveBeenCalled();
	});
});
