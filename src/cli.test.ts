import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { type CliActions, createProgram } from "./cli.ts";

function createMockActions() {
	return {
		initConfig: mock.fn<() => void>(),
		generateBaseline: mock.fn<(p?: string) => Promise<void>>(async () => {}),
		runVisualTests: mock.fn<(p?: string) => void>(),
		inspectPage: mock.fn<(path: string, viewport?: string) => Promise<void>>(
			async () => {},
		),
	};
}

function parse(actions: CliActions, args: string[]) {
	const program = createProgram(actions);
	program.exitOverride();
	program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
	for (const cmd of program.commands) {
		cmd.exitOverride();
		cmd.configureOutput({ writeErr: () => {}, writeOut: () => {} });
	}
	return program.parseAsync(["node", "cli.ts", ...args]);
}

describe("CLI", () => {
	describe("init", () => {
		it("should call initConfig", async () => {
			const actions = createMockActions();
			await parse(actions, ["init"]);
			assert.equal(actions.initConfig.mock.callCount(), 1);
		});
	});

	describe("generate", () => {
		it("should call generateBaseline without path", async () => {
			const actions = createMockActions();
			await parse(actions, ["generate"]);
			assert.equal(actions.generateBaseline.mock.callCount(), 1);
			assert.equal(
				actions.generateBaseline.mock.calls[0].arguments[0],
				undefined,
			);
		});

		it("should call generateBaseline with path", async () => {
			const actions = createMockActions();
			await parse(actions, ["generate", "/about"]);
			assert.equal(actions.generateBaseline.mock.callCount(), 1);
			assert.equal(
				actions.generateBaseline.mock.calls[0].arguments[0],
				"/about",
			);
		});
	});

	describe("test", () => {
		it("should call runVisualTests without path", async () => {
			const actions = createMockActions();
			await parse(actions, ["test"]);
			assert.equal(actions.runVisualTests.mock.callCount(), 1);
			assert.equal(
				actions.runVisualTests.mock.calls[0].arguments[0],
				undefined,
			);
		});

		it("should call runVisualTests with path", async () => {
			const actions = createMockActions();
			await parse(actions, ["test", "/media"]);
			assert.equal(actions.runVisualTests.mock.callCount(), 1);
			assert.equal(actions.runVisualTests.mock.calls[0].arguments[0], "/media");
		});
	});

	describe("inspect", () => {
		it("should call inspectPage with path", async () => {
			const actions = createMockActions();
			await parse(actions, ["inspect", "/media"]);
			assert.equal(actions.inspectPage.mock.callCount(), 1);
			assert.equal(actions.inspectPage.mock.calls[0].arguments[0], "/media");
			assert.equal(actions.inspectPage.mock.calls[0].arguments[1], undefined);
		});

		it("should call inspectPage with path and viewport", async () => {
			const actions = createMockActions();
			await parse(actions, ["inspect", "/media", "--viewport", "mobile"]);
			assert.equal(actions.inspectPage.mock.callCount(), 1);
			assert.equal(actions.inspectPage.mock.calls[0].arguments[0], "/media");
			assert.equal(actions.inspectPage.mock.calls[0].arguments[1], "mobile");
		});

		it("should fail without path argument", async () => {
			const actions = createMockActions();
			await assert.rejects(() => parse(actions, ["inspect"]));
			assert.equal(actions.inspectPage.mock.callCount(), 0);
		});
	});

	describe("unknown command", () => {
		it("should error on unknown command", async () => {
			const actions = createMockActions();
			await assert.rejects(() => parse(actions, ["unknown"]));
		});
	});

	describe("commands do not cross-call", () => {
		it("init should not call other actions", async () => {
			const actions = createMockActions();
			await parse(actions, ["init"]);
			assert.equal(actions.generateBaseline.mock.callCount(), 0);
			assert.equal(actions.runVisualTests.mock.callCount(), 0);
			assert.equal(actions.inspectPage.mock.callCount(), 0);
		});

		it("generate should not call other actions", async () => {
			const actions = createMockActions();
			await parse(actions, ["generate"]);
			assert.equal(actions.initConfig.mock.callCount(), 0);
			assert.equal(actions.runVisualTests.mock.callCount(), 0);
			assert.equal(actions.inspectPage.mock.callCount(), 0);
		});

		it("test should not call other actions", async () => {
			const actions = createMockActions();
			await parse(actions, ["test"]);
			assert.equal(actions.initConfig.mock.callCount(), 0);
			assert.equal(actions.generateBaseline.mock.callCount(), 0);
			assert.equal(actions.inspectPage.mock.callCount(), 0);
		});
	});
});
