# Rheo licensing

Rheo uses the unmodified [PolyForm Shield License 1.0.0](../LICENSE), published by the [PolyForm Project](https://polyformproject.org/licenses/shield/1.0.0). The licensor is Daniel Longfellow; [NOTICE](../NOTICE) contains the required notice to retain with redistributed copies.

Shield is a source-available license, not an open-source license. It permits noncompeting use, modification and redistribution, including ordinary personal and internal workplace use. It restricts providing competing products and services using the software, including free competing offerings. Its definitions and exceptions control; this summary does not replace the license. It has no fixed automatic conversion to MIT, Apache or another license.

For uses outside Shield's permissions, contact the project maintainer to discuss separate permission. No additional commercial agreement or contributor agreement is granted by this document. Establish contribution/relicensing terms before accepting outside code if preserving alternative commercial licensing rights is important.

## Scope and third-party components

Rheo's license applies to original project material. It does not replace the terms for dependencies, the bundled Node runtime, or other third-party material. Retain their notices and satisfy their own licenses when redistributing.

New Mac app builds contain `LICENSE` and `NOTICE` in `Contents/Resources/` and `Contents/Resources/app/`. `THIRD_PARTY_LICENSES.txt`, `licenses/`, `runtime/LICENSE` and the server package notices under `app/node_modules/` retain upstream terms separately. Packaging verification checks that Rheo's bundled license and notice exactly match the source files.

The packager recognizes notice names such as `LICENSE-MIT.txt`. Version-specific [supplemental notices](../third-party-notices/) restore license text omitted from the `abstract-logging` and `drizzle-orm` npm packages, with provenance alongside each text. They are copied both into the app's notice collection and the corresponding runtime package. A runtime dependency with neither a packaged notice nor a version-specific supplement stops the build.

The npm metadata uses `SEE LICENSE IN LICENSE` because Shield is not in the current SPDX license list. The package remains `private: true` to prevent accidental npm publication; this flag neither changes GitHub visibility nor replaces the license.

License selection does not publish the repository, certify ownership/enforceability, or change previously published installer bytes. Copyright coverage of AI-assisted material, ownership and contributor rights remain matters for legal review before a public commercial launch.
