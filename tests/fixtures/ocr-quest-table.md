`ocr-quest-table.png` is a synthetic OCR fixture, not a game screenshot or a record of quest completion.

Rendered for this test using Windows System.Drawing: white 700 × 190 bitmap,
Segoe UI 22 px, black text, AntiAliasGridFit. Headers `Quest Title` and `Completion`
are at (20,20) and (425,20). The two rows at y=65 and y=105 read
`Blackburrow Brewers` / `09/01/2026` and `Clay Bracelet Quest` / `09/02/2026`.
The native test checks recognized phrases and relative word geometry, not exact font rasterization.

The request uses only PNG bytes. No fixture-generation code or child process runs in the application.
