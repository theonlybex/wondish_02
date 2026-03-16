import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { uploadFile } from "@/lib/s3";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) ?? "misc";

    if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Only JPEG, PNG, WebP, and GIF images are allowed." }, { status: 400 });
    if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "File size must be under 5 MB." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const validFolder = ["avatars", "recipes", "misc"].includes(folder) ? (folder as "avatars" | "recipes" | "misc") : "misc";
    const url = await uploadFile(buffer, file.type, validFolder);

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[upload]", err);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
