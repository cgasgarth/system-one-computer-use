# Stable local signing for macOS installs

The installer stops before changing the installed app until a valid
code-signing identity is selected.
An ad hoc signature changes with each rebuild, so macOS may no longer treat
the rebuilt app as the same app for Accessibility access. Apple describes
the designated requirement as the identity rule used to recognize updates
in [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/)
and [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

## One-time local setup

1. Use a valid existing code-signing identity, or create a **dedicated**
   self-signed Code Signing certificate and private key in your **login**
   keychain with Keychain Access > Certificate Assistant. Apple's
   [Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)
   describes the Certificate Assistant path. Keep the private key in the
   user keychain. Do not export it, change global trust, or grant broad key
   access.
2. Run `security find-identity -v -p codesigning`. Copy the 40-character
   fingerprint of that valid identity. If it is absent, stop; the installer
   will not fall back to ad hoc signing.
3. Quit System One Computer Use. Run
   `SYSTEM_ONE_CODESIGN_IDENTITY=<fingerprint> bun run app:install` from the
   repository. If macOS asks to allow `codesign` to use the private key,
   approve that specific use. The installer first signs two harmless probe
   versions and checks that both have the same certificate-bound designated
   requirement. It then builds and verifies a staged bundle before replacing
   the installed app. It does not alter TCC or keychain trust.

The first move from the old ad hoc signature to a certificate signature can
require a one-time Accessibility approval in macOS Settings. Later rebuilds
must use the **same** identity and bundle identifier. The installer accepts
only a valid fingerprint supplied for that run; it never signs ad hoc.

The installer sets an explicit macOS 15.0 deployment target for the app, helper, and signing probes. This prevents a newer toolchain default or shell setting from producing an app that requires a later macOS version than the build machine.
