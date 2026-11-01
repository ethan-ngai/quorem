# Streaming reader lifetimes

Implemented: large-input runner cleanup; separate from hosted activation debugging.

A read-only audit found peek-only `StreamingJsonReader` consumers retaining their source iterator. Reproduction: 40 cases with ~200 KB arguments retained 80 file descriptors after 500 ms. Tiny inputs reached EOF and did not reproduce it; this does not explain the four-case hosted failure.

Shared owner: `packages/questions` streaming JSON reader now provides idempotent closure and a scoped reader helper. Case and metadata projections close prefix reads, full scans and rejected shapes. Argument projection peeks once. Closing the spool's write handle alone does not close its independent read streams.

Validation: the real Node file-stream regression fails without prefix cleanup and passes with it, including repeated large arguments and rejected shapes. Shared streaming JSON tests pass under Node and workerd. No provider or cache/search changes.
