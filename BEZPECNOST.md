# pidgoo 1.10.0 – bezpečnostní přehled

Technický popis ochrany dat, určený k prověření. Popisuje, co pidgoo chrání, jak to dělá, jak bylo testováno a kde jsou známé hranice.

---

## 1. Model hrozeb

| Útočník | Co má k dispozici | Cíl pidgoo |
|---|---|---|
| Útočník v síti (MITM, veřejná Wi-Fi) | odposlech a úprava provozu | žádné heslo ani e-mail po síti nečitelně, žádný downgrade TLS |
| Odesílatel škodlivého e-mailu | HTML, přílohy, hlavičky pod svou kontrolou | žádné spuštění kódu, žádné sledování bez svolení, žádné spuštění přílohy |
| Krádež disku nebo notebooku (offline) | kopie datové složky | bez hesla k pidgoo nic nečitelné; s heslem potřeba i klíč uživatele OS |
| Lokální program pod jiným uživatelem | čtení souborů | soubory `0600`, klíče svázané s účtem OS |
| Zneužití okna aplikace (hypotetický renderer exploit) | volání IPC z okna | žádné čtení libovolných souborů, žádné odeslání uloženého hesla jinam |
| Úprava spouštění (zástupce, přepínače, proměnné) | parametry a prostředí procesu | aplikace se se žádným přepínačem nespustí |

**Mimo rozsah:** plně kompromitovaný účet uživatele v OS, dokud běží odemčené pidgoo. Malware se stejnými právy může číst paměť procesu nebo zaznamenávat klávesy. To neumí zabránit žádná desktopová aplikace.

---

## 2. Uložená data – trezor `pidgoo-vault.json`

Umístění:
- macOS: `~/Library/Application Support/pidgoo/`
- Windows: `%APPDATA%\pidgoo\`

- **Jeden soubor, celý šifrovaný AES-256-GCM.** Šifruje se všechno: účty a hesla k nim, OAuth tokeny, API klíče, kontakty, úkoly, naplánované zprávy, nastavení i seznam blokovaných odesílatelů.
- **Čitelná zůstává jen hlavička:** formát, vzhled pro zamykací obrazovku (`theme`, `lockIdle`, `lockOnSleep`, `screenProtect`) a počítadlo chybných pokusů.
- **Datový klíč (DEK):** 256 bitů z CSPRNG. Každý zápis používá nový 96bitový IV a AAD `pidgoo-vault-v2/data`. Tag GCM (128 bitů) odhalí jakoukoli úpravu souboru a aplikace pak data odmítne.
- **Zabalení DEK:**
  - *Bez hesla k pidgoo:* systémovým úložištěm (macOS Klíčenka / Windows DPAPI přes Electron `safeStorage`). Data jde otevřít jen pod tímto uživatelem na tomto počítači.
  - *S heslem:* `scrypt(N=2^17, r=8, p=1)`, tj. 128 MB paměti na pokus, s 256bitovou solí. Výsledkem se AES-256-GCM zabalí DEK a výsledek se navíc zabalí systémovým úložištěm. Offline útok tedy potřebuje zároveň heslo i klíč uživatele OS. Heslo se nikam neukládá, ani jako otisk.
  - *Záchranný kód:* 16 znaků z abecedy o 32 znacích, tedy 80 bitů bez zkreslení. Balí stejný DEK stejným způsobem.
- **Nový DEK při každé změně:** při zapnutí, změně i vypnutí hesla se vygeneruje nový DEK a celý obsah se přešifruje. Starý klíč je tím bezcenný.
- **Atomický zápis:** dočasný soubor → `fsync` → `rename`, práva `0600`, složka `0700`.
- **Migrace ze starších verzí:** staré soubory (≤ 1.8) se převedou a pak přepíšou náhodnými daty a smažou. Na SSD přepsání fyzicky nezaručuje smazání, proto šifrování vždy.
- **Studený start s heslem:** v paměti není nic, dokud se nezadá heslo. Služby pracující s daty (fronta k odeslání, připomínky, odložené zprávy) se spustí až po odemčení.
- **Brzda proti hádání:** po 5 chybách se čeká 30 s, pak se interval zdvojnásobuje až na 15 min. Počítadlo přežije restart a platí i pro změnu či vypnutí hesla a export. Podvržené „čekej 100 let“ v hlavičce se ořízne na 15 min.
- **Chromium bez stopy na disku:** okna používají session jen v paměti. Cache obrázků, cookies ani localStorage se nezapisují a zbytky ze starších verzí se při startu mažou.

**Přenos do jiného počítače** (soubor `.pidgoo`):
- Šifrování AES-256-GCM, hlavička chráněná jako AAD, `scrypt N=2^17`.
- Přenosový kód má 60 bitů, případně jde použít vlastní heslo s minimem 10 znaků.
- Import odmítne slabší parametry KDF, špatnou délku IV a tagu i nadměrnou velikost souboru.
- Náhled importu ukáže servery, na které se účty budou připojovat.

---

## 3. Síť

- **IMAP/SMTP:**
  - Vždy TLS 1.2+ s ověřeným certifikátem (`rejectUnauthorized`) a SNI.
  - STARTTLS je vynucený (`doSTARTTLS` / `requireTLS`), žádný tichý downgrade.
  - Hodnota zabezpečení je jen `ssl` | `starttls` | `none`. `none` je povolené výhradně pro `localhost`/`127.0.0.1`, typicky pro Proton Bridge.
- **JMAP (RFC 8620/8621):**
  - Jen `https` (výjimka: localhost).
  - Přesměrování pidgoo zpracovává ručně. Přihlašovací údaje jsou přišpendlené k doméně serveru, který uživatel nastavil, i když session ukazuje jinam.
  - Obsah (POST) se nikdy nepošle na cizí doménu.
- **Uložené heslo neodejde na jiný server.** Když se v nastavení účtu změní server, port, zabezpečení nebo uživatel, pidgoo heslo znovu vyžádá. OAuth účty mají servery Googlu a Microsoftu napevno.
- **OAuth 2.0 (Google / Microsoft):**
  - Authorization code + PKCE S256 + `state`, loopback jen na `127.0.0.1`.
  - Nepoužité tokeny se po 15 min zahodí z paměti.
- **Odhlášení z odběru (RFC 8058):**
  - POST jen na https, s pevným tělem.
  - Ochrana proti SSRF: kontrola IP přímo při připojení (odolné vůči DNS rebindingu). Blokuje soukromé, loopback, link-local, CGNAT, multicast, IPv4-mapped, NAT64 a 6to4 adresy.
  - Varianta mailto posílá jen krátký jednořádkový předmět a text, bez kopií.
  - Uživatel před odesláním vidí, kam odhlášení jde.
- **Google Kalendář (od 1.10):**
  - Jen účty přihlášené přes Google OAuth. Rozsahy: `calendar.events` a `calendar.calendarlist.readonly` – žádné sdílení (ACL), nastavení ani mazání kalendářů.
  - Token jde výhradně na pevnou adresu `https://www.googleapis.com/calendar/v3`, `fetch` s `redirect: 'error'` (token neodejde přesměrováním). ID kalendářů a událostí z okna aplikace se kontrolují (události jen `[A-Za-z0-9_-]`, bez `..`), účet musí být Google účet z trezoru.
  - Události se **neukládají na disk** – jen krátká mezipaměť v paměti hlavního procesu (60 s, seznam kalendářů 10 min). Do trezoru jde jen volba viditelných kalendářů a výchozí kalendář.
  - Připomenutí jen pro vlastní kalendáře nebo schůzky, kam je uživatel pozván. Při zamčeném pidgoo oznámení neukáže název ani místo.
- **Překlad (Google Cloud Translation, jen na vyžádání):** API klíč jde v hlavičce `X-Goog-Api-Key`, ne v URL. E-maily se jinak nikam neposílají a nejsou zpracovávány AI.
- **Okno aplikace nemá síť:**
  - CSP `connect-src 'none'`.
  - Filtr `webRequest` pustí vzdálené obrázky jen z rámu s e-mailem (a ten jen po svolení). Vše ostatní ruší.

---

## 4. Škodlivé e-maily a přílohy

- **Tělo e-mailu:**
  - Zobrazuje se v `<iframe srcdoc sandbox="allow-popups">`, tedy bez skriptů, bez same-origin, bez formulářů a bez navigace nahoru.
  - Rám má vlastní CSP `default-src 'none'; img-src data:` (vzdálené obrázky až po kliknutí uživatele) a `form-action 'none'`.
  - HTML se navíc čistí: `script`, `iframe`, `object`, `embed`, `meta`, `base`, `link`, `on*`, `javascript:`/`vbscript:`/`file:` URL.
- **Odpověď a přeposlání:**
  - Citované HTML projde whitelistem tagů, atributů a CSS vlastností.
  - Hodnoty CSS nesmí obsahovat `url`, `image-set`, escapování `\`, `@`, komentáře ani jiné funkce než barvy a `calc()`, aby nic nenačítaly.
  - Vzdálené obrázky se v editoru nenačítají.
- **Odkazy:** ven jdou jen `http(s)` a `mailto` (parsované přes `URL`). Vše ostatní se zahodí.
- **Přílohy:**
  - Z názvů se odstraní řídicí a obousměrné znaky (maskování `faktura‮fdp.exe`), cesty, koncové tečky a mezery a rezervovaná jména Windows.
  - Přímo se otevřou jen dokumenty, obrázky a média (whitelist).
  - Programy, skripty, zástupce, instalátory a aktivní obsah (`.exe .lnk .js .hta .html .svg .docm .iso .app .command …`) nejdou otevřít, jen uložit s varováním. Totéž platí pro soubory, které mají hlavičku programu pod nevinnou příponou (MZ, ELF, Mach-O, `#!`, HTML, SVG).
  - Neznámé typy jde jen uložit.
  - Uložené i otevírané přílohy dostanou značku „staženo z internetu“: Windows `Zone.Identifier` (SmartScreen, Chráněné zobrazení v Office), macOS `com.apple.quarantine` (Gatekeeper).
  - Dočasné soubory jsou v soukromé složce a mažou se při ukončení.

---

### Pozvánky do kalendáře (iCalendar v e-mailu)

- Parser `ics.js` je vlastní, bez závislostí: limit 512 kB, řádek max. 16 kB, max. 20 000 řádků, vnoření max. 8 úrovní, max. 500 účastníků. Časová pásma: IANA, názvy z Windows, jinak VTIMEZONE; délka TZID max. 128 znaků (ochrana proti zahlcení procesoru).
- Vše z pozvánky se v okně escapuje; odkaz „Připojit se k hovoru“ jen pro `meet.google.com`, `zoom.us`, `teams.microsoft.com`/`teams.live.com` přes https.
- **Nic se nestane bez kliknutí.** Přijmout / Možná / Odmítnout se nabízí, jen když je uživatel mezi pozvanými. Odpověď (iMIP REPLY) sestaví hlavní proces – okno nemůže do odchozí zprávy vložit vlastní `text/calendar`.
- **Ochrana proti podvržené pozvánce:** pokud odesílatel e-mailu není organizátor, karta ukáže varování, pozvánka se nespáruje s existující událostí (útočník tak nemůže přes známé UID smazat, odmítnout ani přepsat skutečnou schůzku) a při uložení do kalendáře se organizátor nepřebírá. „Odstranit z kalendáře“ jen u zprávy o zrušení (`METHOD:CANCEL`) od skutečného organizátora a nikdy u schůzek, které organizuje uživatel. Existující událost se stejným UID se nikdy nepřepisuje importem.

---

## 5. Zpevnění aplikace (Electron 44)

- **Okna:**
  - `contextIsolation`, `sandbox` pro všechny procesy (`app.enableSandbox()`), `nodeIntegration: false`, `webSecurity`, `webviewTag: false`, `navigateOnDragDrop: false`.
  - V distribuci jsou vypnuté DevTools.
- **Vlastní protokol `pidgoo://app/`** místo `file://`:
  - Vydává jen soubory ze složky UI (ochrana proti path traversal) s CSP v hlavičce a `nosniff`.
  - `file://` nemá žádná zvláštní práva (pojistka `GrantFileProtocolExtraPrivileges` vypnutá).
- **IPC:**
  - Každý požadavek se ověří: musí přijít z hlavního rámce stránky `pidgoo://app/index.html`.
  - Zamčené pidgoo odpoví jen na odemčení.
- **Soubory k odeslání:** okno nemůže poslat libovolnou cestu. Povolené jsou jen soubory vybrané v systémovém dialogu nebo skutečně přetažené myší, a ani ty nesmí ležet v `~/.ssh`, `~/Library/Keychains`, v profilech prohlížečů, v `AppData` ani v datech pidgoo. `nodemailer` má zakázaný přístup k souborům i URL.
- **Navigace:**
  - Zákaz `<webview>` a nových oken.
  - Okno nesmí navigovat ani přesměrovat pryč z aplikace.
  - Odmítají se stahování i všechna oprávnění kromě notifikací.
- **Spouštění:** zabalená aplikace odmítne start s jakýmkoli přepínačem (`-x`, `--x`, `/x`) a s proměnnými `SSLKEYLOGFILE` a `ELECTRON_ENABLE_LOGGING`. Tím se blokuje např. `--remote-debugging-port`, `--inspect`, `--no-sandbox`, `--renderer-cmd-prefix`, `--proxy-server` nebo `--ignore-certificate-errors`.
- **Electron Fuses:**
  - `RunAsNode` off, `NODE_OPTIONS` off, `--inspect` off.
  - `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on, `GrantFileProtocolExtraPrivileges` off.
  - Na macOS navíc `EnableEmbeddedAsarIntegrityValidation`: otisk `app.asar` (SHA-256) je v podepsaném `Info.plist`.
- **Soukromí:**
  - Volitelná ochrana okna před snímáním obrazovky (`setContentProtection`).
  - Záchranný a přenosový kód se ze schránky smažou po 60 s.
  - Na zamykací obrazovce nic neprosvítá (ani toast s předmětem zprávy).
  - Notifikace při zamčení neukazují obsah.
- **Závislosti:** `npm audit` bez nálezů. Běhové závislosti: imapflow, nodemailer, mailparser, iconv-lite, libqp.

---

## 6. Jak bylo testováno

Automatické testy proti skutečným serverům (Dovecot IMAP, Cyrus 3.8 JMAP s pushem a bez něj) a útoky na zabalenou aplikaci pod neprivilegovaným uživatelem:

| Test | Výsledek |
|---|---|
| Na disku po uložení účtu, hesla a kontaktů nic čitelného (grep celé datové složky) | ✅ |
| Restart s heslem → data nedostupná, IPC vrací „zamčeno“ | ✅ |
| Špatné heslo / záchranný kód → odmítnuto a započítáno | ✅ |
| Úprava 1 bitu v šifrovaných datech → odhaleno (GCM) | ✅ |
| Migrace dat 1.8 → trezor, starý soubor smazán, heslo převedeno | ✅ |
| E-mail s `<script>`, `onerror`, `svg onload`, `meta refresh`, `base`, `@import`, CSS `url()`, `image-set()`, CSS escape, `iframe/object/embed`, `form`, `ping`, `srcset`, `javascript:`/`file:`/`data:` odkazy, XSS v předmětu a jménu | ✅ 0 požadavků na past-server, žádný skript |
| Odpověď a přeposlání takového e-mailu | ✅ nic se nenačte |
| Přílohy `faktura‮fdp.exe`, `smlouva.pdf.lnk`, `scan.pdf` s hlavičkou MZ, `../../tmp/…` | ✅ zablokováno / přejmenováno |
| Z okna aplikace: příloha `/etc/passwd`, `~/.bashrc`, `fetch()`, vzdálený obrázek, `openExternal('file://…')`, přístup k `require`/`process` | ✅ vše zablokováno |
| Z okna aplikace: test / uložení účtu s cizím serverem bez nového hesla (IMAP, JMAP, přepnutí protokolu) | ✅ vyžádá heslo |
| Zabalená aplikace: `--remote-debugging-port`, `-remote-debugging-port`, `/inspect`, `--inspect`, `--no-sandbox`, `--renderer-cmd-prefix`, `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS=--require`, `SSLKEYLOGFILE`, podvržená složka `resources/app` | ✅ vše zablokováno |
| Kalendář: podvržená zpráva o zrušení s UID skutečné schůzky, HTML/`<script>` v názvu, jménu organizátora a účastníků, `javascript:` v místě, cizí odkaz na „videohovor“ | ✅ escapováno, varování, tlačítko i IPC odmítnou |
| Kalendář: TZID `/a` × 200 000, `__proto__`/`constructor` jako pásmo, 20 000 odkazů v popisu události | ✅ < 10 ms, bez pádu |
| Kalendář z okna aplikace: ID události `../../users/me`, cizí účet | ✅ odmítnuto |
| Samostatné review kalendáře (red team); všechny nálezy opraveny | ✅ |
| Dva nezávislé bezpečnostní review kódu (renderer + red team); všechny nálezy opraveny | ✅ |

---

## 7. Známé hranice (poctivě)

1. **Aplikace není podepsaná certifikátem Apple Developer ID ani Authenticode** (je jen ad-hoc podepsaná). macOS ji napoprvé nechá otevřít až po povolení v Nastavení systému. Na Windows není kontrola integrity `app.asar` (bez podpisu by ji šlo obejít výměnou celého `.exe`). Kdo může zapisovat do složky s aplikací, může ji podvrhnout. Doporučení: mít aplikaci v `/Applications`, respektive ve složce bez práv zápisu pro běžné procesy.
2. **Bez hesla k pidgoo** chrání data jen systémové úložiště. Jakýkoli program pod stejným uživatelem je může rozšifrovat, stejně jako u většiny desktopových klientů. **S heslem** jde o skutečné šifrování klíčem z hesla, ale kdo získá i klíč uživatele OS, může heslo hádat offline (scrypt 128 MB na pokus to hodně brzdí). Proto minimum 8 znaků a doporučení delší fráze.
3. **Zamčení za běhu** blokuje okno aplikace. Datový klíč ale zůstává v paměti hlavního procesu, aby mohly odejít naplánované zprávy. Proti malwaru čtoucímu paměť pod stejným uživatelem to neochrání. Studený start s heslem ano.
4. **Okno aplikace má přístup k poště.** Kdyby někdo našel exploit samotného Chromia, mohl by pracovat s poštou. Nemůže ale číst soubory z disku ani odeslat uložená hesla jinam.
5. **Automatické nalezení serveru** (MX/SRV/autoconfig) věří DNS bez DNSSEC. Výsledek jsou ale jen adresy s vynuceným TLS a ověřeným certifikátem.
6. **Aktualizace jsou ruční.** Bezpečnostní opravy Chromia a Electronu přicházejí s novou verzí pidgoo.

---

*pidgoo 1.10.0 · Electron 44 · Chromium, Node.js dle `Nastavení → O aplikaci`.*
