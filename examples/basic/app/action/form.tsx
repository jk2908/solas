import * as counter from './count'

export function ServerCounterForm() {
	return (
		<form action={counter.update}>
			<input type="hidden" name="change" value="1" />
			<button type="button">server value: {counter.get()}</button>

			<button formAction={counter.reset} type="submit">
				reset
			</button>

			<button type="submit">increment</button>
		</form>
	)
}
