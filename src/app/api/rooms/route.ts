import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET - دریافت اتاق با ID
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (id) {
    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 50,
        },
      },
    })

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    return NextResponse.json(room)
  }

  // دریافت لیست اتاق‌ها
  const rooms = await prisma.room.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return NextResponse.json(rooms)
}

// POST - ساخت اتاق جدید
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, videoUrl, videoType } = body

    if (!name || !videoUrl || !videoType) {
      return NextResponse.json(
        { error: 'Name, videoUrl and videoType are required' },
        { status: 400 }
      )
    }

    const room = await prisma.room.create({
      data: {
        name,
        videoUrl,
        videoType,
      },
    })

    return NextResponse.json(room, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create room' },
      { status: 500 }
    )
  }
}
