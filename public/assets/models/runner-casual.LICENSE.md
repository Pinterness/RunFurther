# Runner character source and license

`runner-casual.glb` is **Casual Character (Casual2)** by **Quaternius**, from the Ultimate Modular Men Pack.

- Author and original pack: https://quaternius.com/packs/ultimatemodularcharacters.html
- Individual model and license declaration: https://poly.pizza/m/kZ3DmIoGip
- Download source: https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb
- License: **CC0 1.0 Universal** (public domain dedication).
- License deed: https://creativecommons.org/publicdomain/zero/1.0/
- Full legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode
- Downloaded and checked: 2026-10-01.

Both the author's pack page and the individual model's `Licence` metadata specify CC0. This model is not endorsed by its author for RunFurther. Attribution is retained voluntarily.

The shipped file keeps the Idle, Idle_Neutral, Interact, Run, Walk and Wave clips and removes unused animation accessors/buffer views. Mesh positions, skin weights, rig hierarchy, inverse bind matrices, and retained keyframes are unchanged. No texture or external model URL is requested when the app loads this local file. Runtime material colors and attached race props may differ from the source preview.

Reproduce the asset using `node scripts/prepareRunnerAsset.mjs`. The script verifies the downloaded source hash before preparing the model. It can also accept the original GLB path as an argument for offline preparation.

- Original file: 1,430,660 bytes.
- Original SHA-256: `fea7e71271203e7073f1a073fa1208de7402df276f87f80e149bf7589b5d46b4`.
- Prepared file: 901,768 bytes.
- Prepared SHA-256: `71462ab00d9b1f8715122a28fe246669ec38160133af92c2ed4a566c1ef9f9ca`.

Technical notes: Y-up, forward +Z, standing height approximately 1.85 scene units, feet at Y approximately 0. The original internal armature scale and rotation are part of the skin binding and must remain intact. Three.js sanitizes dots in bone names (`Wrist.L` becomes `WristL`). The character remains a stylized, low-poly prototype rather than a photoreal human scan.
