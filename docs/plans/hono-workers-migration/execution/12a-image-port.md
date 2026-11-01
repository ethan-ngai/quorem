# 12a Image processor seam (#352)

The profile handler accepts a required `ImageProcessor` using Uint8Array and typed processed, unsupported and invalid outcomes. Node composition injects the sharp adapter. The portable handler imports neither sharp nor Node APIs; upload status mapping, pixel and frame checks, orientation, cover resize, WebP encoding, cleanup, rate bounds and storage semantics remain unchanged. No Worker image implementation or private service is selected by this slice.

Validation: `vp -C apps/auth exec tsc --noEmit`; profile and image tests against real sharp and a disposable PostgreSQL 17 auth database: 17 passed, including Better Auth session revocation, format mismatch, invalid bytes, 16-million-pixel limit, two-frame rejection, orientation, 512-pixel crop, no enlargement, metadata stripping and concurrent replacement cleanup. The handler bundled successfully for browser platform with esbuild and no native imports.

Packet 12 remains partial: Worker-safe processing or a private isolated Node image service, hosted image budgets and hosted mail validation are separate gates. This change does not establish a hosted deployment.
