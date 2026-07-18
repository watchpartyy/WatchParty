export interface Room {
  id: string
  name: string
  videoUrl: string
  videoType: 'youtube' | 'direct'
  createdAt: string
  messages?: Message[]
}

export interface Message {
  id: string
  roomId: string
  username: string
  content: string
  createdAt: string
}

export interface User {
  username: string
  isHost: boolean
}

export interface VideoSyncState {
  isPlaying: boolean
  currentTime: number
  timestamp: number
}
