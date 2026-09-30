# pidgoo – zdrojový kód (soukromý)

> Dříve mailoo. Aplikace při prvním spuštění převede data z předchozí verze (`src/migrate.js`).

Jednoduchý a přehledný e-mailový klient pro Windows a Mac (Electron).
Web a instalátory ke stažení: https://pidgoo.com

## Struktura

| Složka | Obsah |
|---|---|
| `src/` | hlavní proces – šifrovaný trezor (`store.js`), zámek aplikace, IMAP/SMTP (`mail.js`), JMAP, OAuth, přílohy (`files.js`) |
| `renderer/` | uživatelské rozhraní (HTML/CSS/JS, přísná CSP) |
| `installer/` | instalátor pro Windows (NSIS) a sestavení DMG pro Mac |
| `build/` | ikony aplikace |
| `licenses/`, `tools/` | licence třetích stran (písma, ikony) a jejich generátor pro O aplikaci |
| `build.js` | sestavení balíčků (Electron fuses, NSIS, DMG) |
| `web/` | zdroj úvodní stránky pidgoo.com |
| `BEZPECNOST.md` | popis zabezpečení – pro bezpečnostní revizi |

## Vývoj

```
npm install
npx electron .          # spuštění
node build.js           # sestavení instalátorů
```
