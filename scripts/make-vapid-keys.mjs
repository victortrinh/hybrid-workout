/**
 * Makes the VAPID key pair the cue timer signs its pushes with (ADR-0006,
 * docs/deploy.md step 9) and prints the commands that store it, with the
 * subject, as the cue timer's secrets. Nothing is written to disk.
 *
 *   npm run make:vapid-keys -- mailto:you@example.com
 */
import { createECDH } from 'node:crypto'

const subject = process.argv[2]
if (!subject || !/^(mailto:|https:\/\/)/.test(subject)) {
  console.error('Give the subject Apple can reach you at: npm run make:vapid-keys -- mailto:you@example.com')
  process.exit(1)
}

const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
const b64url = (buffer) => buffer.toString('base64url')

const put = (name) => `npx wrangler secret put ${name} -c wrangler.cues.jsonc`
console.log(`Run each command and paste the value it's shown with when Wrangler asks for it.

${put('VAPID_PUBLIC_KEY')}
  ${b64url(ecdh.getPublicKey())}

${put('VAPID_PRIVATE_KEY')}
  ${b64url(ecdh.getPrivateKey())}

${put('VAPID_SUBJECT')}
  ${subject}

The private key is shown once. If it's lost, run this again and set all three: the phone then needs Lock-screen cues turned off and on.`)
