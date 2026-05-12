# Zero Dev

Currently, `@project-eleven/libqc` uses the [ZeroDev](https://zerodev.app/) toolkit for building and interacting with accounts.

Note, all ZeroDev logic should be contained in this subdirectory and a clean abstraction should be provided and exported from `@project-eleven/libqc` so that we can swap out ZeroDev for another account solution in the future if desired.
