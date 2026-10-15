/**
 * A stand-in for `cloudflare:workers`, loaded only while Solas imports the
 * Worker bundle in Node for the build-time prerender (see `bindings.ts`). The
 * real module is a workerd built-in, which Node cannot resolve.
 *
 * The exports mirror `@cloudflare/workers-types`' `CloudflareWorkersModule`.
 * There are no bindings at build time, so reading one warns and returns
 * `undefined` rather than throwing, and the classes are inert stubs so a module
 * that extends one still loads. None of this runs on the deployed Worker.
 */
const warned = new Set<PropertyKey>()

function binding(): Record<string, unknown> {
	return new Proxy(
		{},
		{
			get(_target, key) {
				if (!warned.has(key)) {
					warned.add(key)

					console.warn(
						`[solas] "${String(key)}" was read during the build-time ` +
							`prerender, where no bindings exist. It returned undefined. ` +
							`Read it at request time, or guard it with a fallback.`,
					)
				}

				return
			},
		},
	)
}

export const env = binding()
export const exports = binding()
export const cache = binding()
export const tracing = binding()

export function waitUntil(_promise: Promise<unknown>) {}

export function withEnv<T>(_env: unknown, fn: () => T) {
	return fn()
}

export function withExports<T>(_exports: unknown, fn: () => T) {
	return fn()
}

export function withEnvAndExports<T>(_env: unknown, _exports: unknown, fn: () => T) {
	return fn()
}

export class RpcStub {}
export class RpcTarget {}
export class WorkerEntrypoint {}
export class DurableObject {}
export class WorkflowStep {}
export class WorkflowEntrypoint {}
