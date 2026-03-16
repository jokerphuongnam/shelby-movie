import { NextRequest, NextResponse } from "next/server";
import { ALPHA_VIDEO_MAP } from "@/lib/alpha-data.server";
import { verifyStreamToken } from "@/lib/stream-token.server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token || !verifyStreamToken(token, params.id)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const videoUrl = ALPHA_VIDEO_MAP[params.id];
  if (!videoUrl) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const range = req.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(videoUrl, {
      headers: range ? { Range: range } : {},
    });
  } catch {
    return new NextResponse("Upstream unavailable", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });

  const contentRange = upstream.headers.get("Content-Range");
  if (contentRange) headers.set("Content-Range", contentRange);
  const contentLength = upstream.headers.get("Content-Length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
