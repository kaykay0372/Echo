import {beforeEach, describe, expect, it, vi} from "vitest";

async function freshRouter() {
	/* Fresh import of router.js for each test, so that registerRoute/initRouter don't share state between tests. */
	vi.resetModules();
	return import("./router.js");
}

beforeEach(() => {
	location.hash = "";
});

describe("router static and param routes", () => {
	it("calls the matching route's render function with no params for a static route", async () => {
		const {registerRoute, initRouter} = await freshRouter();
		const render = vi.fn();
		registerRoute("/trash", render);

		location.hash = "#/trash";
		initRouter();

		expect(render).toHaveBeenCalledWith({});
	});

	it("extracts :param segments and passes them to render", async () => {
		const {registerRoute, initRouter} = await freshRouter();
		const render = vi.fn();
		registerRoute("/note/:id", render);

		location.hash = "#/note/abc-123";
		initRouter();

		expect(render).toHaveBeenCalledWith({id: "abc-123"});
	});

	it("defaults to / when the hash is empty", async () => {
		const {registerRoute, initRouter} = await freshRouter();
		const render = vi.fn();
		registerRoute("/", render);

		location.hash = "";
		initRouter();

		expect(render).toHaveBeenCalledWith({});
	});

	it("warns and does not throw for an unmatched route", async () => {
		const {registerRoute, initRouter} = await freshRouter();
		registerRoute("/trash", vi.fn());
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		location.hash = "#/nonexistent";
		expect(() => initRouter()).not.toThrow();
		expect(warnSpy).toHaveBeenCalled();

		warnSpy.mockRestore();
	});
});

describe("router cleanup between navigations", () => {
	it("calls the previous route's cleanup function before rendering the next route", async () => {
		const {registerRoute, initRouter, _navigateForTest} = await freshRouter();
		const cleanup = vi.fn();
		registerRoute("/note/:id", () => cleanup);
		registerRoute("/trash", vi.fn());

		location.hash = "#/note/1";
		initRouter();
		expect(cleanup).not.toHaveBeenCalled();

		await _navigateForTest("/trash");
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("does not throw when a route's render function returns no cleanup", async () => {
		const {registerRoute, initRouter, _navigateForTest} = await freshRouter();
		registerRoute("/a", () => undefined);
		registerRoute("/b", vi.fn());

		location.hash = "#/a";
		initRouter();

		// _navigateForTest returns the render promise to assert that it resolves without throwing.
		await expect(_navigateForTest("/b")).resolves.toBeUndefined();
	});

	it("discards a stale render's cleanup if a newer navigation starts first", async () => {
		const {registerRoute, initRouter, _navigateForTest} = await freshRouter();
		const staleCleanup = vi.fn();
		const freshCleanup = vi.fn();

		// Simulates the note editor before returning its cleanup function.
		let resolveSlowRender;
		registerRoute(
			"/note/:id",
			() =>
				new Promise((resolve) => {
					resolveSlowRender = () => resolve(staleCleanup);
				}),
		);
		registerRoute("/trash", () => freshCleanup);

		location.hash = "#/note/1";
		initRouter();

		// Navigate away before the slow render resolves.
		const secondNav = _navigateForTest("/trash");
		resolveSlowRender(); // now the stale render finally resolves
		await secondNav;

		// The stale note-editor cleanup must have been torn down immediately and not clobbered /trash's cleanup.
		expect(staleCleanup).toHaveBeenCalledOnce();
		expect(freshCleanup).not.toHaveBeenCalled();
	});
});
