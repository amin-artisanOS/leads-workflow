
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const WAITLIST_FILE = path.join(process.cwd(), 'waitlist.json');

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Read existing waitlist
    let waitlist = [];
    try {
      const data = await fs.readFile(WAITLIST_FILE, 'utf-8');
      waitlist = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, start with empty list
    }

    // Check if email already exists
    if (waitlist.some((entry: any) => entry.email === email)) {
      return NextResponse.json({ success: true, message: 'Already on the waitlist!' });
    }

    // Add new entry
    waitlist.push({
      email,
      timestamp: new Date().toISOString(),
      status: 'waiting'
    });

    // Save back to file
    await fs.writeFile(WAITLIST_FILE, JSON.stringify(waitlist, null, 2));

    return NextResponse.json({ success: true, message: 'Successfully joined the waitlist!' });
  } catch (error) {
    console.error('Waitlist error:', error);
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 });
  }
}
