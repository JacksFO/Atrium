import { AccessToken } from 'livekit-server-sdk'
import { config } from './config.js'

/**
 * Voice tokens.
 *
 * LiveKit is a separate process that only trusts signed tokens, so this is
 * where our permissions become its permissions. A member who cannot speak in
 * Atrium gets a token that cannot publish audio in LiveKit — enforcement
 * lives in the token, not in the UI that requested it.
 */

export function voiceConfigured(): boolean {
  return Boolean(config.livekitUrl && config.livekitKey && config.livekitSecret)
}

export type VoiceGrants = {
  canPublish: boolean
  canPublishData: boolean
  canSubscribe: boolean
}

export async function mintVoiceToken(
  userId: string,
  displayName: string,
  channelId: string,
  grants: VoiceGrants
): Promise<string> {
  const token = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: userId,
    name: displayName,
    // Short-lived. Rejoining mints a fresh one, so a revoked permission takes
    // effect on the next join rather than lingering for hours.
    ttl: '2h',
  })

  token.addGrant({
    room: channelId,
    roomJoin: true,
    canPublish: grants.canPublish,
    canSubscribe: grants.canSubscribe,
    canPublishData: grants.canPublishData,
    // Only the server may change what someone is allowed to publish.
    roomAdmin: false,
    canUpdateOwnMetadata: false,
  })

  return token.toJwt()
}
