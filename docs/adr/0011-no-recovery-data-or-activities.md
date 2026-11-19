# No Recovery data or Activities: pain is the only Readiness input

On 19 November 2026 the athlete asked to remove the Apple Watch workout import and the sleep data. This reverses [ADR-0003](0003-recovery-data-via-apple-health-shortcut.md) and [ADR-0004](0004-activities-via-apple-health-shortcut.md).

- **No Recovery data.** The morning Shortcut, `/api/recovery`, the short-sleep change to Up next, the low-HRV easy-day Suggestion and the Recovery chart on Progress are gone. Readiness is the latest Pain report, and Readiness flags count pain only: three in a Week still suggest the rest of it a third lighter.
- **No Activities.** The Workout Shortcut, `/api/activities`, the Coach's matching, "Which Session was this?", the watch line in the Bucket, "From the watch" in Log after and the console-distance prompt for a treadmill run are gone. A Session done with the watch is logged in Log after like any other. Live sessions still ask for the console distance on the treadmill.
- **No service token.** Only the Shortcuts used the narrow Access exception in [ADR-0001](0001-cloudflare-access-instead-of-app-auth.md). With them gone, the whole site, `/api` included, asks for the email code, and the Worker checks no token of its own.
- **The tables stay.** `recovery_nights`, `activities` and `activity_answers` keep whatever they held. Nothing reads or writes them, but the export still includes them, so that data can still be downloaded. A later migration can drop them.

What it gives up: the Coach no longer sees a bad night, and the athlete types each Session's minutes in Log after instead of having the watch fill them in. The training plan's sleep rule goes with it, and the Operating rules after it move up one (docs/training-plan.md).
