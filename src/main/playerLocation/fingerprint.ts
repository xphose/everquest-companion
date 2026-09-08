import { createHash } from 'node:crypto'
import { closeSync, fstatSync, openSync, readSync, statSync, type BigIntStats } from 'node:fs'
import { LEGENDS_PROFILE } from './profile'

export interface FileIdentity {
  key: string
  size: bigint
}

export interface FingerprintFiles {
  inspect(path: string): FileIdentity
  digest(path: string, identity: FileIdentity): string
}

function identityOf(stat: BigIntStats): FileIdentity {
  if (!stat.isFile()) throw new Error('The game executable is not a regular file')
  return {
    key: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'),
    size: stat.size
  }
}

function hashImage(path: string, expected: FileIdentity): string {
  const file = openSync(path, 'r')
  try {
    if (identityOf(fstatSync(file, { bigint: true })).key !== expected.key) throw new Error('Game file changed')
    const hash = createHash('sha256')
    const bytes = Buffer.alloc(64 * 1024)
    let remaining = LEGENDS_PROFILE.fileSize
    while (remaining > 0) {
      const count = readSync(file, bytes, 0, Math.min(bytes.length, remaining), null)
      if (count === 0) throw new Error('Game file was truncated')
      hash.update(bytes.subarray(0, count))
      remaining -= count
    }
    if (readSync(file, bytes, 0, 1, null) !== 0) throw new Error('Game file grew')
    if (identityOf(fstatSync(file, { bigint: true })).key !== expected.key) throw new Error('Game file changed')
    return hash.digest('hex')
  } finally {
    closeSync(file)
  }
}

const DISK: FingerprintFiles = {
  inspect: path => identityOf(statSync(path, { bigint: true })),
  digest: hashImage
}

/** One file only. A patch, replacement, timestamp change or root change invalidates the digest. */
export class FingerprintCache {
  private cached: { path: string; key: string; supported: boolean } | null = null

  constructor(private readonly files: FingerprintFiles = DISK) {}

  supports(path: string): boolean {
    const identity = this.files.inspect(path)
    if (this.cached?.path === path && this.cached.key === identity.key) return this.cached.supported
    this.cached = null
    const supported = identity.size === BigInt(LEGENDS_PROFILE.fileSize) &&
      this.files.digest(path, identity) === LEGENDS_PROFILE.sha256
    this.cached = { path, key: identity.key, supported }
    return supported
  }

  close(): void {
    this.cached = null
  }
}
