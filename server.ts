import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { Server } from 'socket.io'
import { PrismaClient } from '@prisma/client'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const prisma = new PrismaClient()

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error handling request:', err)
      res.statusCode = 500
      res.end('Internal Server Error')
    }
  })

  const io = new Server(server, {
    path: '/api/socketio',
    cors: {
      origin: process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : '*',
      methods: ['GET', 'POST'],
    },
  })

  // ── State ──
  const rooms = new Map<string, Set<string>>()
  const socketUserMap = new Map<string, { username: string; roomId: string }>()
  const emptyRoomTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const ROOM_EMPTY_TIMEOUT = 60_000 // 60 seconds

  // ── Delete empty room from DB and cleanup ──
  async function deleteRoom(roomId: string) {
    console.log(`[Cleanup] Deleting empty room ${roomId}`)
    try {
      await prisma.room.delete({ where: { id: roomId } })
      console.log(`[Cleanup] Room ${roomId} deleted from database`)
    } catch (err) {
      console.error(`[Cleanup] Failed to delete room ${roomId}:`, err)
    }
  }

  // ── Start empty-room timer ──
  function startEmptyTimer(roomId: string) {
    if (emptyRoomTimers.has(roomId)) return
    const timer = setTimeout(() => {
      emptyRoomTimers.delete(roomId)
      // Double-check room is still empty
      const users = rooms.get(roomId)
      if (!users || users.size === 0) {
        rooms.delete(roomId)
        deleteRoom(roomId)
      }
    }, ROOM_EMPTY_TIMEOUT)
    emptyRoomTimers.set(roomId, timer)
    console.log(`[Cleanup] Timer started for room ${roomId} (${ROOM_EMPTY_TIMEOUT / 1000}s)`)
  }

  // ── Cancel empty-room timer ──
  function cancelEmptyTimer(roomId: string) {
    const timer = emptyRoomTimers.get(roomId)
    if (timer) {
      clearTimeout(timer)
      emptyRoomTimers.delete(roomId)
      console.log(`[Cleanup] Timer cancelled for room ${roomId}`)
    }
  }

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    socket.on('join-room', ({ roomId, username }) => {
      socket.join(roomId)
      socketUserMap.set(socket.id, { username, roomId })

      // Cancel any pending deletion timer
      cancelEmptyTimer(roomId)

      if (!rooms.has(roomId)) rooms.set(roomId, new Set())
      rooms.get(roomId)!.add(username)

      const userCount = rooms.get(roomId)!.size
      io.to(roomId).emit('user-joined', { username, userCount })
      console.log(`${username} joined room ${roomId}. Count: ${userCount}`)
    })

    socket.on('leave-room', ({ roomId }) => {
      const userData = socketUserMap.get(socket.id)
      if (userData) {
        const roomUsers = rooms.get(roomId)
        if (roomUsers) {
          roomUsers.delete(userData.username)
          if (roomUsers.size === 0) {
            // Room is empty — start deletion timer
            startEmptyTimer(roomId)
          }
        }

        const userCount = rooms.get(roomId)?.size || 0
        socket.to(roomId).emit('user-left', { username: userData.username, userCount })
        console.log(`${userData.username} left room ${roomId}. Count: ${userCount}`)
      }
      socket.leave(roomId)
    })

    socket.on('chat-message', ({ roomId, message }) => {
      io.to(roomId).emit('chat-message', message)
    })

    socket.on('video-sync', ({ roomId, isPlaying, currentTime, timestamp }) => {
      socket.to(roomId).emit('video-sync', { isPlaying, currentTime, timestamp })
    })

    socket.on('disconnect', () => {
      const userData = socketUserMap.get(socket.id)
      if (userData) {
        const { username, roomId } = userData
        const roomUsers = rooms.get(roomId)

        if (roomUsers) {
          roomUsers.delete(username)
          if (roomUsers.size === 0) {
            startEmptyTimer(roomId)
          } else {
            io.to(roomId).emit('user-left', { username, userCount: roomUsers.size })
          }
        }

        socketUserMap.delete(socket.id)
        console.log(`${username} disconnected from room ${roomId}`)
      } else {
        console.log('User disconnected:', socket.id)
      }
    })
  })

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> Socket.io server running on /api/socketio`)
  })
})
