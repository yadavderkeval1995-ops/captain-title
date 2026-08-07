# Captain Title authentication testing

Google OAuth returns to `window.location.origin + '/editor'` with `#session_id=...`. The frontend must exchange that value through `POST /api/auth/google/session`; the backend alone calls Emergent Auth session-data. Sessions are seven-day, secure, httpOnly, SameSite=None cookies. `/api/auth/me` is the source of truth and also accepts a Bearer token for API testing.

For browser testing, create an email/password user through `/api/auth/register`, capture `X-Session-Token`, then use it as `Authorization: Bearer <token>` for protected API calls. Verify Google callback detection uses `useLocation().hash`, and that logout removes the backend session and cookie.