// Sestavení rozbalitelných balíčků pro Windows a macOS.
const { packager } = require('@electron/packager');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Pojistky přímo v binárce Electronu – nejdou změnit bez přepsání (a u Macu bez porušení podpisu) aplikace.
async function fuses(exe, platform) {
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false, // Mac se podepisuje hned potom (rcodesign)
    [FuseV1Options.RunAsNode]: false,                          // ELECTRON_RUN_AS_NODE nespustí pidgoo jako Node.js
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS nevloží cizí kód
    [FuseV1Options.EnableNodeCliInspectArguments]: false,      // --inspect nepřipojí ladicí nástroj
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,                  // žádná podvržená složka „app“ vedle archivu
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: platform === 'darwin', // Mac: kontrola otisku app.asar při startu
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: GRANT_FILE
  });
}
const GRANT_FILE = process.env.PIDGOO_GRANT_FILE === '1';

const OUT = path.join(__dirname, 'dist');
const common = {
  dir: __dirname,
  out: OUT,
  name: 'pidgoo',
  executableName: 'pidgoo',
  appVersion: pkg.version,
  appBundleId: 'cz.pidgoo.app',
  appCategoryType: 'public.app-category.productivity',
  appCopyright: '© 2026 Jaroslav Mistoler',
  overwrite: true,
  asar: true,
  prune: true,
  ignore: [/^\/node_modules\/pst-extractor\/(example|test|src)($|\/)/, /^\/dist($|\/)/, /^\/installer($|\/)/, /^\/tools($|\/)/, /^\/licenses($|\/)/, /^\/build\.js$/, /^\/build\/icon\.(ico|icns)$/, /^\/\.git/],
  win32metadata: { ProductName: 'pidgoo', FileDescription: 'pidgoo', CompanyName: 'Jaroslav Mistoler' }
};

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('licence třetích stran:', require('./tools/licenses').build());
  const only = process.env.PIDGOO_TARGETS ? process.env.PIDGOO_TARGETS.split(',') : null;
  const targets = [
    { platform: 'linux', arch: 'x64', icon: 'build/icon.png', zip: null },
    { platform: 'win32', arch: 'x64', icon: 'build/icon.ico', zip: 'pidgoo-app-windows.zip' },
    { platform: 'darwin', arch: 'arm64', icon: 'build/icon.icns', zip: 'pidgoo-app-mac-applesilicon.zip' },
    { platform: 'darwin', arch: 'x64', icon: 'build/icon.icns', zip: 'pidgoo-app-mac-intel.zip' }
  ];
  for (const t of targets.filter(x => only ? only.includes(x.platform) : x.platform !== 'linux')) {
    const [dir] = await packager(Object.assign({}, common, { platform: t.platform, arch: t.arch, icon: t.icon }));
    console.log('packaged', dir);
    if (t.platform === 'darwin') {
      const app = path.join(dir, 'pidgoo.app');
      await fuses(path.join(app, 'Contents', 'MacOS', 'pidgoo'), 'darwin');
      execSync(`rcodesign sign "${app}"`, { stdio: 'inherit' });
      execSync(`cd "${dir}" && zip -qry -y "${path.join(OUT, t.zip)}" pidgoo.app`);
      // Klasický instalátor pro Mac: DMG s oknem „přetáhněte do Aplikací“
      const dmg = path.join(OUT, 'pidgoo-' + pkg.version + '-' + (t.arch === 'arm64' ? 'applesilicon' : 'intel') + '.dmg');
      execSync(`python3 installer/mac/builddmg.py "${app}" "${dmg}" ${pkg.version}`, { cwd: __dirname, stdio: 'inherit' });
    } else if (t.platform === 'linux') {
      await fuses(path.join(dir, 'pidgoo'), 'linux');
      continue;
    } else {
      await fuses(path.join(dir, 'pidgoo.exe'), 'win32');
      // Klasický instalátor (NSIS): průvodce, volba složky, zástupci, odinstalace.
      const setup = path.join(OUT, 'pidgoo-setup-' + pkg.version + '.exe');
      execSync(`makensis -V2 -DVERSION=${pkg.version} "-DSRC=${dir}" "-DOUT=${setup}" pidgoo.nsi`, { cwd: path.join(__dirname, 'installer'), stdio: 'inherit' });
      console.log('installer', path.basename(setup));
      const name = 'pidgoo app';
      fs.renameSync(dir, path.join(OUT, name));
      execSync(`cd "${OUT}" && zip -qr "${t.zip}" "${name}" && rm -rf "${name}"`);
    }
    console.log('zipped', t.zip);
  }
})().catch(e => { console.error(e); process.exit(1); });
