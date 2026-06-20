import { NextRequest, NextResponse } from 'next/server';

// TODO: generate Open Graph images using @vercel/og
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { message: 'OG image generation not yet implemented' },
    { status: 501 },
  );
}
