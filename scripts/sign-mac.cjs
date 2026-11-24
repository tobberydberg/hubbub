// electron-builder afterPack hook: signs the macOS app with Hubbub's own (self-signed) certificate.
//
// Hubbub isn't signed by an Apple Developer ID. Signed ad hoc, every build is a different app to
// macOS, so permissions like Screen Recording are lost on each update. Signed with the same
// certificate every time, macOS knows it is the same app.
//
// Runs only when HUBBUB_MAC_SIGN is set (the release workflow sets it, along with electron-builder's
// own signing turned off by mac.identity=null):
//   HUBBUB_MAC_IDENTITY  the certificate's SHA-1 or name, or "-" to sign ad hoc
//   HUBBUB_MAC_KEYCHAIN  the keychain holding it
// Hardened runtime stays off: it is only needed for Apple's notarization, and without a team ID it
// would keep the app from loading its own frameworks.

const path = require('node:path')
const { signApp } = require('@electron/osx-sign')

exports.default = async function signMac(context) {
  if (context.electronPlatformName !== 'darwin' || !process.env.HUBBUB_MAC_SIGN) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const identity = process.env.HUBBUB_MAC_IDENTITY || '-'
  const entitlements = path.resolve(__dirname, '../build/entitlements.mac.plist')
  console.log(`  • signing ${path.basename(app)} with ${identity === '-' ? 'an ad hoc signature' : identity}`)
  await signApp({
    app,
    platform: 'darwin',
    identity,
    keychain: process.env.HUBBUB_MAC_KEYCHAIN || undefined,
    // The certificate isn't trusted by the system, which this check would require
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({ hardenedRuntime: false, entitlements, timestamp: 'none' })
  })
}
