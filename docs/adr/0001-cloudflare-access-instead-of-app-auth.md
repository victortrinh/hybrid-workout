# Cloudflare Access instead of in-app authentication

The app has exactly one user, so instead of building sign-in we host everything on Cloudflare (Workers, D1) and put the whole site behind Cloudflare Access with an email one-time code. Machine callers get narrow exceptions: the morning iOS Shortcut authenticates with an Access service token, and the Strava webhook path bypasses Access and is verified with Strava's own subscription token. This keeps hosting free and removes all login code, at the cost of tying auth to Cloudflare; moving hosts later means adding real authentication.
