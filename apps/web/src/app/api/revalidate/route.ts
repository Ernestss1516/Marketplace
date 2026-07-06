import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ message: 'Invalid secret' }, { status: 401 });
  }

  // tag busts a tag-based cache (unstable_cache) — used by the footer, which is
  // cached independently of any single page/route's own ISR window. path keeps
  // the original per-route revalidation behavior.
  const tag = request.nextUrl.searchParams.get('tag');
  if (tag) {
    revalidateTag(tag);
    return NextResponse.json({ revalidated: true, tag });
  }

  const path = request.nextUrl.searchParams.get('path') ?? '/';
  revalidatePath(path);
  return NextResponse.json({ revalidated: true, path });
}
