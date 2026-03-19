import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(accounts);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const account = await prisma.account.create({
      data: {
        email: data.email,
        name: data.name,
        service: data.service || "smtp",
        smtpHost: data.smtpHost,
        smtpPort: parseInt(data.smtpPort),
        smtpUser: data.smtpUser,
        smtpPass: data.smtpPass,
        imapHost: data.imapHost,
        imapPort: parseInt(data.imapPort),
        imapUser: data.imapUser,
        imapPass: data.imapPass,
      },
    });
    return NextResponse.json(account);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
