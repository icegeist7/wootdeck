# Third-party software

The native helper dynamically loads an unmodified Wooting Analog SDK 0.9.1 DLL bundled beside it. The SDK is licensed under MPL 2.0; the license is in `licenses/Wooting-Analog-SDK-MPL-2.0.txt`. Its corresponding source is available at https://github.com/WootingKb/wooting-analog-sdk/tree/v0.9.1 . No SDK source files were modified. The SDK source remains available under the Mozilla Public License 2.0; recipients may obtain that source from the versioned link above and exercise the rights granted by that license. The exact tested DLL SHA-256 is `CDBBE1183E248AC18979DE4F8E71BD2E26CB369DAEF835C1C7E3E64ECC09C5FB`.

The TypeScript bundle uses the official Elgato Stream Deck SDK and its dependencies, including the nested @elgato/schemas package. Exact bundled Node packages, versions, and license identifiers are listed in `licenses/bundled-node-packages.json`. The Rust executable uses the crates pinned in `native/Cargo.lock` in the source project; their metadata is recorded in `licenses/bundled-rust-packages.json`. Their license texts are copied into `licenses/` by the build script.

The HID command findings were initially researched using the community wootswitch protocol notes at commit 247a784869e30bb6cb89406fa9726db63f899ebf and then corrected against physical hardware reports. The helper implementation is original to WootDeck. This plugin is an independent project and does not imply endorsement by Wooting or Elgato.

## Lucide icons

Logo/category and action icons use Keyboard, Mouse Pointer Click, Repeat 2, Arrow Left Right, List Checks, and Gauge from Lucide, commit `2ca268e74888d3506b3319fb8f94aaaaf70ceca9`. SVGs are rendered white with transparent backgrounds; WootDeck wordmark/layout is original. The upstream ISC/Feather MIT notices are included in `licenses/lucide-LICENSE`. Source: https://github.com/lucide-icons/lucide/tree/2ca268e74888d3506b3319fb8f94aaaaf70ceca9/icons .

## Original WootDeck code

Original WootDeck code is GPL-3.0-or-later. See the included LICENSE, NOTICE.md and SOURCE.txt. This does not replace the separate third-party licenses above.
