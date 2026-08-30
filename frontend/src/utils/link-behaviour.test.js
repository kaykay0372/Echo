import {beforeEach, describe, expect, it} from "vitest";
import {getLinkAutoConfirm, setLinkAutoConfirm} from "./link-behaviour.js";

beforeEach(() => {
	window.localStorage.clear();
});

describe("link-behaviour preference", () => {
	it("defaults to manual approval (false) when nothing is stored", () => {
		expect(getLinkAutoConfirm()).toBe(false);
	});

	it("persists true when set", () => {
		setLinkAutoConfirm(true);
		expect(getLinkAutoConfirm()).toBe(true);
	});

	it("persists false when set back", () => {
		setLinkAutoConfirm(true);
		setLinkAutoConfirm(false);
		expect(getLinkAutoConfirm()).toBe(false);
	});
});
