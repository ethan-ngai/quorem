# Profile photos and account menu

Issue #47. Account identity comes from Better Auth's authenticated cookie session; product roles remain server-owned in Go.

- `/api/auth/profile`: current name/email/username/photo, never browser-selected user IDs.
- `PUT /api/auth/profile-photo`: PNG/JPEG/WebP, 5 MiB and 16 MP limits, one static image. Decode, strip metadata, crop/resize within 512px and re-encode WebP before S3 storage. Exact-origin/session checks, bounded concurrency/rate, compare-and-set replacement and cleanup protect writes.
- `DELETE /api/auth/profile-photo`: clear the photo and delete the previous object. Raw Better Auth image updates are blocked; provider refreshes preserve app-authored photos.
- `/api/auth/profile-photos/<uuid>`: proxy only currently referenced private objects. The S3 bucket is private; no public bucket ACL or browser S3 credentials. Profile photos shown through the app are public avatar images.

`make dev` prepares owner-readable ignored `.local/garage-preview.json` and `.local/garage.toml`, then starts pinned Garage 2.4.1 with persistent `garage-data`. Its S3 endpoint is loopback `http://127.0.0.1:53900`; RPC is unexposed. Auth receives the local bucket/key automatically. Setting a different `AVATAR_S3_ENDPOINT` skips Garage provisioning. Deployment uses a real private S3 bucket and IAM credentials through the SDK's default credential provider; deployment remains the infrastructure gate in #15.

Local Garage is a single-node fixture, following the [official quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/). It proves the S3 contract, not cloud durability.

The compact account popover has an avatar/name/email header, working profile/theme actions and a red logout footer. Workspace settings is a separate trigger immediately left of profile. Photos are circular with no stroke; missing or broken photos use name/username-derived HTML initials, never generated images. Light/dark and narrow-screen verification uses the live Vite server.
