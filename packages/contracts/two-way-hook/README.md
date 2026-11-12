# Two-way hook reference contract

Creates a NEAR yield for an action and resumes it only when the configured responder calls `resume_action`. Pending requests are keyed by increasing request IDs, and resume/timeout callbacks clear their state.

See the [contracts guide](../README.md) for build, test, deployment, and call instructions. This reference contract exercises yield/resume; it does not perform off-chain HTTP requests itself.
